import { create } from "@bufbuild/protobuf";
import { ImagePlusIcon, Trash2Icon, ImageIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { attachmentServiceClient } from "@/connect";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import { getAttachmentUrl } from "@/utils/attachment";
import SettingGroup from "./SettingGroup";
import SettingSection from "./SettingSection";

interface BackgroundImage {
  url: string;
  name: string;
  filename: string;
}

const STORAGE_KEY = "memos-background-images";

const loadBackgroundImages = (): BackgroundImage[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const saveBackgroundImages = (images: BackgroundImage[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(images));
  window.dispatchEvent(new CustomEvent("background-images-changed"));
};

const BackgroundSection = () => {
  const [images, setImages] = useState<BackgroundImage[]>(loadBackgroundImages);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = () => setImages(loadBackgroundImages());
    window.addEventListener("background-images-changed", handler);
    return () => window.removeEventListener("background-images-changed", handler);
  }, []);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      const newImages: BackgroundImage[] = [];

      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;

        const buffer = new Uint8Array(await file.arrayBuffer());
        const attachmentRequest = create(AttachmentSchema, {
          filename: file.name,
          size: BigInt(file.size),
          type: file.type,
          content: buffer,
        });

        const attachment = await attachmentServiceClient.createAttachment({
          attachment: attachmentRequest,
        });

        const url = getAttachmentUrl(attachment);
        newImages.push({ url, name: attachment.name, filename: attachment.filename });
      }

      const updated = [...images, ...newImages];
      setImages(updated);
      saveBackgroundImages(updated);
    } catch (err) {
      console.error("Failed to upload background image:", err);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [images]);

  const handleRemove = useCallback((index: number) => {
    const updated = images.filter((_, i) => i !== index);
    setImages(updated);
    saveBackgroundImages(updated);
  }, [images]);

  return (
    <SettingSection>
      <SettingGroup title="背景图 Background Images" description="上传图片作为页面背景，每次访问随机展示 Upload images for random page backgrounds">
        <div className="flex flex-col gap-4 w-full">
          {images.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {images.map((img, index) => (
                <div key={img.url} className="group relative aspect-video rounded-lg overflow-hidden border border-border bg-muted">
                  <img
                    src={img.url}
                    alt={img.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center">
                    <button
                      onClick={() => handleRemove(index)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-full bg-red-500/80 hover:bg-red-500 text-white"
                      title="删除 Remove"
                    >
                      <Trash2Icon className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-black/50 text-white text-xs truncate opacity-0 group-hover:opacity-100 transition-opacity">
                    {img.filename}
                  </div>
                </div>
              ))}
            </div>
          )}

          {images.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground border border-dashed border-border rounded-lg">
              <ImageIcon className="w-10 h-10 mb-2 opacity-40" />
              <p className="text-sm">暂无背景图 No background images yet</p>
              <p className="text-xs mt-1">上传高清图片，每次打开页面随机展示为背景</p>
              <p className="text-xs">Upload HD images to display as random page backgrounds</p>
            </div>
          )}

          <div className="flex items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleUpload}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-border bg-background hover:bg-accent text-foreground transition-colors disabled:opacity-50"
            >
              <ImagePlusIcon className="w-4 h-4" />
              {uploading ? "上传中 Uploading..." : "添加背景图 Add Images"}
            </button>
            <span className="text-xs text-muted-foreground">
              {images.length} 张图片 / {images.length} image(s)
            </span>
          </div>
        </div>
      </SettingGroup>
    </SettingSection>
  );
};

export default BackgroundSection;

export { loadBackgroundImages, STORAGE_KEY };
