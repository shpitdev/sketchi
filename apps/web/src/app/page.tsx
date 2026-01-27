"use client";
import { Wand2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-8">
      <div className="mx-auto mb-8 flex justify-center">
        <Image
          alt="Sketchi"
          height={80}
          priority
          src="/icons/logo-wide.svg"
          width={240}
        />
      </div>

      <div className="grid gap-6">
        <section className="rounded-lg border p-4">
          <h2 className="mb-2 font-medium">Icon Library Generator</h2>
          <p className="mb-4 text-muted-foreground text-sm">
            Create icon libraries, upload SVGs, and export .excalidrawlib files.
          </p>
          <Link href="/library-generator">
            <Button className="shadow-sm">
              <Wand2 />
              Open generator
            </Button>
          </Link>
        </section>
      </div>
    </div>
  );
}
