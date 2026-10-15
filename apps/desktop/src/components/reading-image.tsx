import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { imagePlaceholder, type LocalImages } from "../client/local-images";
import type { ReadingSearchRegistry } from "../client/reading-search-registry";
import type { LocalImageResult } from "../shared/local-images";

export function ReadingImagePlaceholder({
  alt,
  search,
}: {
  alt: string;
  search?: ReadingSearchRegistry;
}) {
  const host = useRef<HTMLSpanElement>(null),
    text = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (host.current)
      return search?.mount(host.current, { kind: "image", alt: text.current });
  }, [alt, search]);
  return (
    <span ref={host} className="text-muted-foreground">
      [图片尚未加载：
      {alt ? (
        <span ref={text} className="text-muted-foreground">
          {alt}
        </span>
      ) : (
        "无替代文字"
      )}
      ]
    </span>
  );
}

export function ReadingImage({
  reference,
  alt,
  images,
  search,
}: {
  reference: string;
  alt: string;
  images: LocalImages;
  search?: ReadingSearchRegistry;
}) {
  const element = useRef<HTMLSpanElement>(null);
  const visibleAlt = useRef<HTMLSpanElement>(null);
  const [result, setResult] = useState<LocalImageResult | null>(null);
  const [failed, setFailed] = useState(false);
  const blocked = imagePlaceholder(reference);
  useLayoutEffect(() => {
    if (element.current)
      return search?.mount(element.current, {
        kind: "image",
        alt: visibleAlt.current,
      });
  }, [search, reference, images, result, failed, blocked, alt]);
  useEffect(() => {
    if (result !== null)
      element.current?.dispatchEvent(
        new Event("reading-image-settled", { bubbles: true })
      );
  }, [result, failed]);
  useEffect(() => {
    let current = true;
    let requested = false;
    let releasePresentation: (() => void) | null = null;
    setResult(null);
    setFailed(false);
    if (blocked) return;
    const request = () => {
      if (requested) return;
      requested = true;
      void images.load(reference).then((value) => {
        if (!current) return;
        if (value.ok) {
          releasePresentation = images.reservePresentation(value);
          if (!releasePresentation) {
            setResult({ ok: false, error: "UNAVAILABLE" });
            return;
          }
        }
        setResult(value);
      });
    };
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          request();
        }
      },
      {
        root: element.current?.closest("[data-reading-theme]"),
        rootMargin: "200px",
      }
    );
    if (element.current) observer.observe(element.current);
    return () => {
      current = false;
      observer.disconnect();
      releasePresentation?.();
    };
  }, [reference, images, blocked]);
  return (
    <span ref={element} className="reading-image">
      {!blocked && result?.ok && !failed ? (
        <img
          src={`data:${result.mime};base64,${result.data}`}
          alt={alt}
          width={result.width}
          height={result.height}
          decoding="async"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="text-muted-foreground">
          [
          {blocked ??
            (result || failed ? "图片无法加载或超出资源限制" : "图片等待加载")}
          ：
          {alt ? (
            <span ref={visibleAlt} className="text-muted-foreground">
              {alt}
            </span>
          ) : (
            "无替代文字"
          )}
          ]
        </span>
      )}
    </span>
  );
}
