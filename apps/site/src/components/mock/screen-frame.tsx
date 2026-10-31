import Image from 'next/image';

type ScreenFrameProps = {
  src: string;
  alt: string;
  /** Tailwind height classes for the visible window onto the screenshot. */
  heightClass?: string;
  className?: string;
};

/**
 * A real screenshot of the app, in a browser frame. The image is cropped from the top so the part that
 * matters stays in view. The app was captured with its built-in sample data; client names were replaced.
 */
export function ScreenFrame({ src, alt, heightClass = 'h-[24rem] sm:h-[28rem] lg:h-[31rem]', className = '' }: ScreenFrameProps) {
  return (
    <div className={`overflow-hidden rounded-[1.25rem] bg-surface shadow-[0_50px_100px_-40px_rgb(20_23_28/0.35),0_30px_60px_-30px_rgb(30_101_227/0.25)] ring-1 ring-ink/10 ${className}`}>
      <div className="flex items-center gap-1.5 border-b border-line bg-surface px-4 py-2.5" aria-hidden="true">
        <span className="size-2.5 rounded-full bg-ink/15" />
        <span className="size-2.5 rounded-full bg-ink/15" />
        <span className="size-2.5 rounded-full bg-ink/15" />
        <span className="mx-auto rounded-md bg-paper px-12 py-0.5 font-mono text-[11px] text-ink-3">app.idraft.ai</span>
      </div>
      <div className={`relative ${heightClass}`}>
        <Image src={src} alt={alt} fill sizes="(min-width: 1024px) 1256px, 100vw" className="object-cover object-top" />
      </div>
    </div>
  );
}
