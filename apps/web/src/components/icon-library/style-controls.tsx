import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { StyleSettings } from "@/lib/icon-library/svg-to-excalidraw";

const fillStyles = ["hachure", "solid", "cross-hatch", "zigzag"] as const;

interface StyleControlsProps {
  onChange: (next: StyleSettings) => void;
  value: StyleSettings;
}

export default function StyleControls({ value, onChange }: StyleControlsProps) {
  const update = <K extends keyof StyleSettings>(
    key: K,
    next: StyleSettings[K]
  ) => {
    onChange({ ...value, [key]: next });
  };

  return (
    <div className="grid gap-2">
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs" htmlFor="roughness">
            Roughness
          </Label>
          <span className="text-muted-foreground text-xs">
            {value.roughness}
          </span>
        </div>
        <input
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted"
          id="roughness"
          max="2"
          min="0"
          onChange={(e) => update("roughness", Number(e.target.value))}
          step="0.1"
          type="range"
          value={value.roughness}
        />
      </div>
      <div className="grid gap-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs" htmlFor="bowing">
            Bowing
          </Label>
          <span className="text-muted-foreground text-xs">{value.bowing}</span>
        </div>
        <input
          className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted"
          id="bowing"
          max="10"
          min="0"
          onChange={(e) => update("bowing", Number(e.target.value))}
          step="0.5"
          type="range"
          value={value.bowing}
        />
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
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={value.randomize}
            id="randomize"
            onCheckedChange={(checked) => update("randomize", checked === true)}
          />
          <Label className="text-muted-foreground text-xs" htmlFor="randomize">
            Randomize hatch angle
          </Label>
        </div>
      </div>
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={value.pencilFilter}
            id="pencilFilter"
            onCheckedChange={(checked) =>
              update("pencilFilter", checked === true)
            }
          />
          <Label
            className="text-muted-foreground text-xs"
            htmlFor="pencilFilter"
          >
            Pencil filter
          </Label>
        </div>
      </div>
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={value.showLabel}
            id="showLabel"
            onCheckedChange={(checked) => update("showLabel", checked === true)}
          />
          <Label className="text-muted-foreground text-xs" htmlFor="showLabel">
            Show icon labels
          </Label>
        </div>
      </div>
      {value.showLabel && (
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs" htmlFor="labelSize">
              Label size
            </Label>
            <span className="text-muted-foreground text-xs">
              {value.labelSize}px
            </span>
          </div>
          <input
            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-muted"
            id="labelSize"
            max="24"
            min="8"
            onChange={(e) => update("labelSize", Number(e.target.value))}
            step="1"
            type="range"
            value={value.labelSize}
          />
        </div>
      )}
    </div>
  );
}
