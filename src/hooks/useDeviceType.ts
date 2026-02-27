import { useWindowSize } from "./useWindowSize";
import { getDeviceType, type DeviceType } from "@/lib/devicePreferences";

/**
 * Returns the current device type (mobile, tablet, laptop, pc) from viewport width.
 * Uses useWindowSize so it updates on resize.
 */
export function useDeviceType(): DeviceType {
  const { width } = useWindowSize();
  return getDeviceType(width);
}
