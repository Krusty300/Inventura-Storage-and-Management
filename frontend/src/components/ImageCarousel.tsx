import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ProductImage } from "../types";

interface Props {
  images: ProductImage[];
  imageUrl?: string;
  alt: string;
  className?: string;
}

export default function ImageCarousel({ images, imageUrl, alt, className = "" }: Props) {
  const allImages = images.length > 0 ? images : imageUrl ? [{ id: 0, url: imageUrl, sort_order: 0 }] : [];
  const [current, setCurrent] = useState(0);

  if (allImages.length === 0) return null;

  const hasMultiple = allImages.length > 1;

  return (
    <div className={`relative ${className}`}>
      <div className="flex justify-center">
        <img
          src={allImages[current].url}
          alt={alt}
          className="w-full max-w-md h-64 rounded-lg object-cover border border-border"
        />
      </div>
      {hasMultiple && (
        <>
          <button
            onClick={() => setCurrent((c) => (c === 0 ? allImages.length - 1 : c - 1))}
            className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-surface/80 border border-border hover:bg-surface text-ink shadow-sm"
            aria-label="Previous image"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={() => setCurrent((c) => (c === allImages.length - 1 ? 0 : c + 1))}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-surface/80 border border-border hover:bg-surface text-ink shadow-sm"
            aria-label="Next image"
          >
            <ChevronRight size={18} />
          </button>
          <div className="flex justify-center gap-1.5 mt-3">
            {allImages.map((img, i) => (
              <button
                key={img.id}
                onClick={() => setCurrent(i)}
                className={`w-8 h-8 rounded border-2 overflow-hidden ${i === current ? "border-indigo-500" : "border-border opacity-60 hover:opacity-100"}`}
              >
                <img src={img.url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
          <p className="text-center text-xs text-muted mt-1">{current + 1} / {allImages.length}</p>
        </>
      )}
    </div>
  );
}
