declare module "react-rotary-knob" {
  import type { CSSProperties, ComponentType } from "react";

  export interface KnobSkin {
    knobX: number;
    knobY: number;
    updateAttributes?: unknown[];
    svg: string;
  }

  export interface KnobProps {
    min?: number;
    max?: number;
    step?: number;
    value?: number;
    defaultValue?: number;
    clampMin?: number;
    clampMax?: number;
    rotateDegrees?: number;
    preciseMode?: boolean;
    unlockDistance?: number;
    skin?: KnobSkin;
    style?: CSSProperties;
    onChange?: (value: number) => void;
    onStart?: () => void;
    onEnd?: () => void;
    [key: string]: unknown;
  }

  export const Knob: ComponentType<KnobProps>;
}

declare module "react-svgmt/dist/index.js" {
  import type { ComponentType } from "react";

  export const SvgLoader: ComponentType<Record<string, unknown>>;
  export const SvgProxy: ComponentType<Record<string, unknown>>;

  const mod: {
    SvgLoader: typeof SvgLoader;
    SvgProxy: typeof SvgProxy;
  };
  export default mod;
}
