//! Limited-v1 internal index. Caller-owned cache only; never a document writer.
use std::{collections::{BTreeMap,BTreeSet}, fmt::Write, fs,
    panic::{catch_unwind,AssertUnwindSafe}, path::Path, ptr, slice, str, sync::Once};
use tantivy::{collector::DocSetCollector, query::{AllQuery,BooleanQuery,Occur,Query,TermQuery},
    schema::{Field,IndexRecordOption,Schema,Value,STORED,STRING},
    Index,IndexReader,IndexWriter,ReloadPolicy,TantivyDocument,Term};

const INPUT:u32=1; const LIMIT:u32=2; const IO:u32=3; const SCHEMA:u32=4;
const POISON:u32=6; const READONLY:u32=7; const PANIC:u32=8;
const LIVE_BYTES:usize=65536; const MAX_WIRE:usize=70000; const OUTPUT:usize=150000;
const CONFIG:&[u8]=b"bridge=1\nschema=1\ntantivy=0.27.0\nprofile=literal-gram-v1\n";
static HOOK:Once=Once::new();
type R<T>=Result<T,u32>;
#[derive(Clone)] struct Doc {path:String,raw:String}
pub struct IndexSession {index:Index, reader:IndexReader, writer:Option<IndexWriter<TantivyDocument>>,
    id:Field,path:Field,raw:Field,gram:Field,live:BTreeMap<String,Doc>,
    generation:u64,mutations:u64,poison:bool,pending:bool}

fn schema()->(Schema,[Field;4]) { let mut b=Schema::builder();
    let id=b.add_text_field("id",STRING|STORED);let path=b.add_text_field("path",STORED);
    let raw=b.add_text_field("raw",STORED);let gram=b.add_text_field("gram",STRING);
    (b.build(),[id,path,raw,gram]) }
#[cfg(feature="bridge-test")]
fn hex(s:&str)->String { let mut out=String::new();for b in s.as_bytes(){write!(&mut out,"{b:02x}").unwrap();}out }
fn grams(s:&str,query:bool)->R<Vec<String>> {
    let chars:Vec<char>=s.chars().collect();let sizes=if query{vec![chars.len().min(3)]}else{vec![1,2,3]};
    let mut set=BTreeSet::new();
    for n in sizes {if n==0||chars.len()<n{continue;}for window in chars.windows(n){
        let mut token=format!("g{n}x");for c in window{write!(&mut token,"{:06x}",*c as u32).unwrap();}
        // Query can exceed 128 and fall back; document complete gram budget is explicit.
        if !set.contains(&token)&&set.len()>=200000{return Err(LIMIT);}set.insert(token);
    }}Ok(set.into_iter().collect())
}
fn text(bytes:&[u8],max:usize)->R<&str>{if bytes.len()>max{return Err(LIMIT);}str::from_utf8(bytes).map_err(|_|INPUT)}
fn identity(s:&str)->bool{!s.is_empty()&&s.len()<=32&&s.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-')}
fn path_field(s:&str)->bool{!s.is_empty()&&s.len()<=128&&!s.contains('\0')}
fn read_live(index:&Index,reader:&IndexReader,fields:[Field;4])->R<BTreeMap<String,Doc>>{
    let searcher=reader.searcher();if searcher.num_docs()>16{return Err(LIMIT);}let mut live=BTreeMap::new();let mut total=0;
    for address in searcher.search(&AllQuery,&DocSetCollector).map_err(|_|IO)? {
        let doc=searcher.doc::<TantivyDocument>(address).map_err(|_|IO)?;
        let id=doc.get_first(fields[0]).and_then(|v|v.as_str()).ok_or(SCHEMA)?;
        let path=doc.get_first(fields[1]).and_then(|v|v.as_str()).ok_or(SCHEMA)?;
        let raw=doc.get_first(fields[2]).and_then(|v|v.as_str()).ok_or(SCHEMA)?;
        total+=raw.len();if !identity(id)||!path_field(path)||total>LIVE_BYTES||live.len()>=16{return Err(SCHEMA);}
        if live.insert(id.to_owned(),Doc{path:path.into(),raw:raw.into()}).is_some(){return Err(SCHEMA);}
    }let _=index;Ok(live)
}
fn open_session(path:&str,mode:u32)->R<IndexSession>{
    let p=Path::new(path);if !p.is_absolute()||path.contains('\0')||path.len()>4096{return Err(INPUT);}
    let (schema,fields)=schema();
    let index=if mode==0 {
        if p.exists(){return Err(INPUT);}fs::create_dir(p).map_err(|_|IO)?;
        fs::write(p.join("bridge.schema"),CONFIG).map_err(|_|IO)?;
        Index::create_in_dir(p,schema.clone()).map_err(|_|IO)?
    } else if mode==1 {
        // Controlled independent fixtures, not a TOCTOU-safe authorization boundary.
        if !p.is_dir()||!p.join(".tantivy-meta.lock").is_file(){return Err(SCHEMA);}
        let mut file=std::fs::File::open(p.join("bridge.schema")).map_err(|_|SCHEMA)?;
        if file.metadata().map_err(|_|SCHEMA)?.len()!=CONFIG.len() as u64{return Err(SCHEMA);}
        let mut config=vec![0;CONFIG.len()+1];use std::io::Read;
        let count=file.read(&mut config).map_err(|_|SCHEMA)?;
        if count!=CONFIG.len()||&config[..count]!=CONFIG{return Err(SCHEMA);}
        Index::open_in_dir(p).map_err(|_|SCHEMA)?
    } else{return Err(INPUT);};
    if index.schema()!=schema{return Err(SCHEMA);}
    let reader=index.reader_builder().reload_policy(ReloadPolicy::Manual).try_into().map_err(|_|IO)?;
    let live=read_live(&index,&reader,fields)?;
    let payload=index.load_metas().map_err(|_|IO)?.payload;
    let generation=match payload {None if mode==0||live.is_empty()=>0,Some(v)=>v.strip_prefix("bridge-v1:").ok_or(SCHEMA)?.parse().map_err(|_|SCHEMA)?,_=>return Err(SCHEMA)};
    let writer=if mode==0{Some(index.writer_with_num_threads::<TantivyDocument>(1,50*1024*1024).map_err(|_|IO)?)}else{None};
    Ok(IndexSession{index,reader,writer,id:fields[0],path:fields[1],raw:fields[2],gram:fields[3],live,generation,mutations:0,poison:false,pending:false})
}
struct Cursor<'a>{data:&'a[u8],at:usize}
impl<'a> Cursor<'a>{fn u32(&mut self)->R<usize>{let bytes=self.bytes(4)?;Ok(u32::from_le_bytes(bytes.try_into().unwrap()) as usize)}
 fn bytes(&mut self,n:usize)->R<&'a[u8]>{let end=self.at.checked_add(n).ok_or(INPUT)?;let b=self.data.get(self.at..end).ok_or(INPUT)?;self.at=end;Ok(b)} }
impl IndexSession {
 fn batch(&mut self,data:&[u8])->R<String>{
    if self.writer.is_none(){return Err(READONLY);}if self.pending{return Err(INPUT);}
    // Before clones/grams/doc values: worst wire scalars <= bytes, <=3 windows/scalar.
    // Two sets of 128-byte value nodes + 24-byte token storage, raw/parse copies,
    // fixed arena and response scratch. Logical reservation, not allocator RSS cap.
    let reserve=50*1024*1024+2*MAX_WIRE*3*(128+24)+8*(LIVE_BYTES+MAX_WIRE)+OUTPUT;
    if data.len()>MAX_WIRE||reserve>128*1024*1024{return Err(LIMIT);}
    let mut c=Cursor{data,at:0};let count=c.u32()?;if count==0||count>16{return Err(LIMIT);}
    let mut next=self.live.clone();let mut changes=Vec::new();let mut ids=BTreeSet::new();
    for _ in 0..count{let kind=c.u32()?;let il=c.u32()?;let pl=c.u32()?;let rl=c.u32()?;
        let id=text(c.bytes(il)?,32)?.to_owned();let path=text(c.bytes(pl)?,128)?.to_owned();let raw=text(c.bytes(rl)?,LIVE_BYTES)?.to_owned();
        if !identity(&id)||!ids.insert(id.clone()){return Err(INPUT);}
        if kind==1 {if !path_field(&path){return Err(INPUT);}next.insert(id.clone(),Doc{path:path.clone(),raw:raw.clone()});}
        else if kind==2 {if pl!=0||rl!=0{return Err(INPUT);}next.remove(&id);}else{return Err(INPUT);}
        changes.push((kind,id,path,raw));
    }
    if c.at!=data.len(){return Err(INPUT);}if next.len()>16||next.values().map(|d|d.raw.len()).sum::<usize>()>LIVE_BYTES{return Err(LIMIT);}
    // Complete documents/grams and all budget validation BEFORE first delete/add.
    let mut prepared=Vec::new();let mut token_bytes=0usize;let mut token_count=0usize;
    for (kind,id,path,raw) in changes{let mut doc=TantivyDocument::default();
        if kind==1{doc.add_text(self.id,&id);doc.add_text(self.path,&path);doc.add_text(self.raw,&raw);
            for token in grams(&raw,false)?{token_bytes+=token.len();token_count+=1;
                if token_bytes>3_200_000||token_count>200000{return Err(LIMIT);}doc.add_text(self.gram,token);}}
        prepared.push((kind,id,doc));
    }
    // Actual consumption also checked under the earlier conservative reservation.
    if token_count*128+token_bytes+4*LIVE_BYTES+50*1024*1024>128*1024*1024{return Err(LIMIT);}
    let writer=self.writer.as_mut().ok_or(READONLY)?;self.mutations+=1;
    for(kind,id,doc)in prepared{writer.delete_term(Term::from_field_text(self.id,&id));if kind==1{writer.add_document(doc).map_err(|_|IO)?;}}
    self.live=next;self.pending=true;Ok(String::new())
 }
 fn commit(&mut self)->R<String>{
    if !self.pending{return Err(INPUT);}let next=self.generation.checked_add(1).ok_or(LIMIT)?;
    let writer=self.writer.as_mut().ok_or(READONLY)?;
    let mut prepared=writer.prepare_commit().map_err(|_|IO)?;prepared.set_payload(&format!("bridge-v1:{next}"));
    prepared.commit().map_err(|_|IO)?;self.generation=next;self.pending=false;
    self.reader.reload().map_err(|_|IO)?;Ok(String::new())
 }
 fn query(&self,q:&str)->R<String>{
    if self.pending{return Err(INPUT);}if q.encode_utf16().count()>4096{return Err(LIMIT);}if q.is_empty(){return Ok(String::new());}
    let tokens=grams(q,true)?;let query:Box<dyn Query>=if tokens.len()>128{Box::new(AllQuery)}else{
        Box::new(BooleanQuery::new(tokens.iter().map(|t|(Occur::Must,Box::new(TermQuery::new(Term::from_field_text(self.gram,t),IndexRecordOption::Basic)) as Box<dyn Query>)).collect()))};
    let searcher=self.reader.searcher();if searcher.num_docs()>16{return Err(LIMIT);}let mut rows=Vec::new();
    for address in searcher.search(query.as_ref(),&DocSetCollector).map_err(|_|IO)?{
        let doc=searcher.doc::<TantivyDocument>(address).map_err(|_|IO)?;
        let id=doc.get_first(self.id).and_then(|v|v.as_str()).ok_or(SCHEMA)?;
        let raw=doc.get_first(self.raw).and_then(|v|v.as_str()).ok_or(SCHEMA)?;
        if rows.len()>=16||raw.len()>LIVE_BYTES{return Err(LIMIT);}let mut line=String::new();
        if let Some(pos)=raw.find(q){let start=raw[..pos].encode_utf16().count();writeln!(&mut line,"H\t{id}\t{start}\t{}",start+q.encode_utf16().count()).unwrap();}
        rows.push((id.to_owned(),line));
    }rows.sort_by(|a,b|a.0.cmp(&b.0));if rows.windows(2).any(|w|w[0].0==w[1].0){return Err(SCHEMA);}
    Ok(rows.into_iter().map(|(_,s)|s).collect())
 }
 #[cfg(feature="bridge-test")]
 fn live_rows(&self)->R<String>{if self.pending{return Err(INPUT);}let live=read_live(&self.index,&self.reader,[self.id,self.path,self.raw,self.gram])?;
    let mut out=String::new();for(id,d)in live{writeln!(&mut out,"D\t{id}\t{}\t{}",hex(&d.path),hex(&d.raw)).unwrap();}Ok(out)}
}

#[no_mangle] pub extern "C" fn index_abi_version()->u32{1}
#[no_mangle] pub unsafe extern "C" fn index_open(data:*const u8,len:usize,mode:u32,out:*mut *mut IndexSession,generation:*mut u64)->u32{
    if out.is_null()||generation.is_null(){return INPUT;}*out=ptr::null_mut();if data.is_null()||len==0||len>4096{return INPUT;}
    HOOK.call_once(||std::panic::set_hook(Box::new(|_|eprintln!("INDEX_PANIC"))));
    match catch_unwind(AssertUnwindSafe(||{let path=text(slice::from_raw_parts(data,len),4096)?;open_session(path,mode)})){
        Ok(Ok(s))=>{*generation=s.generation;*out=Box::into_raw(Box::new(s));0},Ok(Err(code))=>code,Err(_)=>PANIC}
}
#[no_mangle] pub unsafe extern "C" fn index_call(s:*mut IndexSession,op:u32,input:*const u8,len:usize,out:*mut u8,cap:usize,meta:*mut u64)->u32{
    if s.is_null()||meta.is_null()||len>MAX_WIRE||cap>OUTPUT||out.is_null()||(input.is_null()&&len!=0){return INPUT;}
    let session=&mut *s;let m=slice::from_raw_parts_mut(meta,4);m.copy_from_slice(&[session.generation,0,session.mutations,session.poison as u64]);
    if session.poison{return POISON;}if cap<OUTPUT {m[1]=OUTPUT as u64;return LIMIT;} // reserve before ANY mutation
    let bytes=if len==0{&[]}else{slice::from_raw_parts(input,len)};
    let before=session.mutations;
    let result=catch_unwind(AssertUnwindSafe(||match op{
        1=>{session.batch(bytes)?;session.commit()},3=>session.query(text(bytes,16384)?),
        #[cfg(feature="bridge-test")]
        4 if len==0=>session.live_rows(),
        #[cfg(feature="bridge-test")]
        90=>panic!("fixed pre mutation"),#[cfg(feature="bridge-test")]
        91=>{session.batch(bytes)?;session.commit()?;panic!("fixed post commit");},_=>Err(INPUT)}));
    let code=match result{Ok(Ok(value))=>{if value.len()>cap{session.poison=true;LIMIT}else{ptr::copy_nonoverlapping(value.as_ptr(),out,value.len());m[1]=value.len() as u64;0}},
        Ok(Err(code))=>{if code==IO||session.mutations!=before||session.pending{session.poison=true;}code},Err(_)=>{session.poison=true;PANIC}};
    m[0]=session.generation;m[2]=session.mutations;m[3]=session.poison as u64;code
}
#[no_mangle] pub unsafe extern "C" fn index_close(s:*mut IndexSession)->u32{
    if s.is_null(){return 5;} // C wrapper ensures exact-once ownership, not arbitrary pointers.
    match catch_unwind(AssertUnwindSafe(||{let mut session=Box::from_raw(s);
        let mut error=None;
        if let Some(mut w)=session.writer.take(){if session.pending||session.poison{if w.rollback().is_err(){error=Some(IO);}}
            if w.wait_merging_threads().is_err()&&error.is_none(){error=Some(IO);}}
        drop(session);match error{Some(c)=>Err(c),None=>Ok::<(),u32>(())}})){Ok(Ok(()))=>0,Ok(Err(c))=>c,Err(_)=>PANIC}
}
