import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { StyleSettings } from "@/lib/icon-library/svg-to-excalidraw";

const strokeStyles = ["solid", "dashed", "dotted"] as const;
const fillStyles = ["solid", "hachure", "cross-hatch", "zigzag"] as const;

interface StyleControlsProps {
  value: StyleSettings;
  onChange: (next: StyleSettings) => void;
}

export default function StyleControls({ value, onChange }: StyleControlsProps) {
  const update = <K extends keyof StyleSettings>(
    key: K,
    next: StyleSettings[K]
  ) => {
    onChange({ ...value, [key]: next });
  };
  const isTransparent = value.backgroundColor === "transparent";

  return (
    <div className="grid gap-2">
      <div className="grid gap-2">
        <Label className="text-xs" htmlFor="strokeColor">
          Stroke color
        </Label>
        <Input
          id="strokeColor"
          onChange={(event) => update("strokeColor", event.target.value)}
          type="color"
          value={value.strokeColor}
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-xs" htmlFor="backgroundColor">
          Fill color
        </Label>
        <div className="flex items-center gap-3">
          <Input
            disabled={isTransparent}
            id="backgroundColor"
            onChange={(event) => update("backgroundColor", event.target.value)}
            type="color"
            value={isTransparent ? "#ffffff" : value.backgroundColor}
          />
          <div className="flex items-center gap-2">
            <Checkbox
              checked={isTransparent}
              id="transparentFill"
              onCheckedChange={(checked) =>
                update("backgroundColor", checked ? "transparent" : "#ffffff")
              }
            />
            <Label
              className="text-muted-foreground text-xs"
              htmlFor="transparentFill"
            >
              Transparent
            </Label>
          </div>
        </div>
      </div>
      <div className="grid gap-2">
        <Label className="text-xs" htmlFor="strokeWidth">
          Stroke width
        </Label>
        <Input
          id="strokeWidth"
          min={0}
          onChange={(event) =>
            update("strokeWidth", Number(event.target.value) || 0)
          }
          step={0.5}
          type="number"
          value={value.strokeWidth}
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-xs" htmlFor="roughness">
          Roughness
        </Label>
        <Input
          id="roughness"
          min={0}
          onChange={(event) =>
            update("roughness", Number(event.target.value) || 0)
          }
          step={1}
          type="number"
          value={value.roughness}
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-xs" htmlFor="opacity">
          Opacity
        </Label>
        <Input
          id="opacity"
          max={100}
          min={0}
          onChange={(event) =>
            update("opacity", Number(event.target.value) || 0)
          }
          step={5}
          type="number"
          value={value.opacity}
        />
      </div>
      <div className="grid gap-2">
        <Label className="text-xs" htmlFor="strokeStyle">
          Stroke style
        </Label>
        <select
          className="h-9 rounded-none border border-input bg-background px-2 text-xs"
          id="strokeStyle"
          onChange={(event) =>
            update(
              "strokeStyle",
              event.target.value as StyleSettings["strokeStyle"]
            )
          }
          value={value.strokeStyle}
        >
          {strokeStyles.map((style) => (
            <option key={style} value={style}>
              {style}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-2">
        <Label className="text-xs" htmlFor="fillStyle">
          Fill style
        </Label>
        <select
          className="h-9 rounded-none border border-input bg-background px-2 text-xs"
          id="fillStyle"
          onChange={(event) =>
            update(
              "fillStyle",
              event.target.value as StyleSettings["fillStyle"]
            )
          }
          value={value.fillStyle}
        >
          {fillStyles.map((style) => (
            <option key={style} value={style}>
              {style}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
