import type { ComponentType } from "react";
import * as svgmtModule from "react-svgmt/dist/index.js";

const svgmt = ((svgmtModule as { default?: unknown }).default ?? svgmtModule) as {
  SvgLoader: ComponentType<Record<string, unknown>>;
  SvgProxy: ComponentType<Record<string, unknown>>;
};

export const SvgLoader = svgmt.SvgLoader;
export const SvgProxy = svgmt.SvgProxy;
