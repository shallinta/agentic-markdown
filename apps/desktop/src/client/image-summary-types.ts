import { CANONICAL_CONFIG } from "./current-canonical-protocol";
export const IMAGE_SUMMARY_CONFIG = `${CANONICAL_CONFIG}:editing-images-1`;
export interface ImageSource {
  url: string;
  title: string | null;
}
export interface ImageSemantic {
  from: number;
  to: number;
  rawFrom: number;
  rawTo: number;
  source: number;
  alt: string;
}
export interface ImageSummary {
  sources: ImageSource[];
  images: ImageSemantic[];
}
