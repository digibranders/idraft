import Image from 'next/image';

const ENGINES = [
  { name: 'Google', src: '/logos/google.svg', width: 77 },
  { name: 'ChatGPT by OpenAI', src: '/logos/openai.svg', width: 86 },
  { name: 'Gemini', src: '/logos/gemini.svg', width: 98 },
] as const;

/** Logos only, under the hero. Grayscale until hovered so the three marks read as one row. */
export function Engines() {
  return (
    <section aria-label="Answer engines tracked" className="mx-auto max-w-[1320px] px-5 md:px-8">
      <div className="flex flex-col items-start gap-6 border-t border-line py-10 sm:flex-row sm:items-center sm:gap-14">
        <p className="text-sm text-ink-3">Answers tracked in</p>
        <ul className="flex flex-wrap items-center gap-x-12 gap-y-6">
          {ENGINES.map((engine) => (
            <li key={engine.name}>
              <Image
                src={engine.src}
                alt={engine.name}
                width={engine.width}
                height={24}
                unoptimized
                className="h-6 w-auto opacity-55 grayscale transition duration-500 ease-heavy hover:opacity-100 hover:grayscale-0"
              />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
