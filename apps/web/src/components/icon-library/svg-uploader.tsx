import { useRef } from "react";

import { Button } from "@/components/ui/button";

interface SvgUploaderProps {
  isUploading: boolean;
  onUpload: (files: FileList) => Promise<void>;
}

export default function SvgUploader({
  isUploading,
  onUpload,
}: SvgUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0) {
      return;
    }

    await onUpload(event.target.files);

    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={isUploading}
          onClick={() => inputRef.current?.click()}
          size="sm"
          type="button"
        >
          {isUploading ? "Uploading…" : "Upload SVGs"}
        </Button>
        <span className="text-muted-foreground text-xs">
          SVG only, max 256KB each
        </span>
      </div>
      <input
        accept="image/svg+xml"
        className="hidden"
        multiple
        onChange={handleChange}
        ref={inputRef}
        type="file"
      />
    </div>
  );
}
