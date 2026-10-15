import { EDITING_CANONICAL_PROFILE } from "../shared/markdown-profile";
export const IMAGE_SUMMARY_CONFIG = `${EDITING_CANONICAL_PROFILE}:editing-images-2`;
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
