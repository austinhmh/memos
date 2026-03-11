import { blogEditorSchema } from "./schema";
import { createMdParser } from "./markdownParser";

const schema = blogEditorSchema;
const parser = createMdParser(schema);

self.onmessage = (e: MessageEvent<{ id: string; content: string }>) => {
  const { id, content } = e.data;
  try {
    const doc = parser.parse(content || "");
    const json = doc.toJSON();
    (self as unknown as Worker).postMessage({ id, json });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
