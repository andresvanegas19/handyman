import type { ImgHTMLAttributes } from "react";

export default function Image({ unoptimized, ...props }: ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) {
  // A native image keeps this standalone harness independent of Next's image server.
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} data-unoptimized={unoptimized} alt={props.alt ?? ""}/>;
}
