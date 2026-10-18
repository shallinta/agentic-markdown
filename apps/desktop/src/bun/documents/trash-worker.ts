import { runTrash,type TrashInput } from "./trash-operation";
self.onmessage=async(event:MessageEvent<TrashInput>)=>{self.postMessage(await runTrash(event.data));};
