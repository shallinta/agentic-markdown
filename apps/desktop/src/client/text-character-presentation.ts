import { WidgetType, type EditorView } from "@codemirror/view";
import { characterEntities } from "character-entities";

/** CommonMark decoding only; never browser HTML numeric-reference semantics. */
export function decodeTextCharacter(
  kind: "Escape" | "Entity",
  source: string
): string | null {
  if (kind === "Escape")
    return /^\\[!-/:-@[-`{-~]$/.test(source) ? source.slice(1) : null;
  const numeric = /^&#(?:([0-9]{1,7})|[xX]([\da-fA-F]{1,6}));$/.exec(source);
  if (numeric) {
    const value =
      numeric[1] === undefined
        ? Number.parseInt(numeric[2], 16)
        : Number.parseInt(numeric[1], 10);
    return value === 0 ||
      value > 0x10ffff ||
      (value >= 0xd800 && value <= 0xdfff)
      ? "\uFFFD"
      : String.fromCodePoint(value);
  }
  const named = /^&([A-Za-z][A-Za-z0-9]{0,30});$/.exec(source);
  return named &&
    Object.prototype.hasOwnProperty.call(characterEntities, named[1])
    ? characterEntities[named[1]]
    : null;
}

/** Conservative display fallback, not a change to the Markdown interpretation. */
export function displayTextCharacter(
  kind: "Escape" | "Entity",
  source: string
): string | null {
  const value = decodeTextCharacter(kind, source);
  return value &&
    !/[\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u.test(
      value
    )
    ? value
    : null;
}

export class TextCharacterWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: TextCharacterWidget) {
    return this.text === other.text;
  }
  toDOM(view: EditorView): HTMLElement {
    const span = view.dom.ownerDocument.createElement("span");
    span.className = "cm-live-character";
    span.textContent = this.text;
    return span;
  }
  ignoreEvent() {
    return false;
  }
}
