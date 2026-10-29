import Image from 'next/image';

type CropProps = {
  src: string;
  alt: string;
  /** Where in the screenshot to look, as CSS object-position (for example "0% 40%"). */
  focus: string;
  /** Zoom into the screenshot so a small part fills the box. 1 shows the whole width. */
  zoom?: number;
  className?: string;
};

/** A cropped, zoomed window onto a real screenshot, for use inside a feature card. */
export function Crop({ src, alt, focus, zoom = 1.6, className = '' }: CropProps) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-surface ring-1 ring-ink/[0.08] ${className}`}>
      <Image src={src} alt={alt} fill sizes="(min-width: 1024px) 40vw, 100vw" className="max-w-none object-cover" style={{ objectPosition: focus, transform: `scale(${zoom})`, transformOrigin: focus }} />
    </div>
  );
}
