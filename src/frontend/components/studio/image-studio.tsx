"use client"

import { useState } from "react"
import { Card, CardHeader, CardTitle, CardContent } from "@/frontend/components/ui/card"
import { Button } from "@/frontend/components/ui/button"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/frontend/components/ui/select"
import { Slider } from "@/frontend/components/ui/slider"
import { Bullet } from "@/frontend/components/ui/bullet"
import { Loader2, Sparkles, Download } from "lucide-react"

const MODELS = [
  { id: "flux-pro", name: "FLUX Pro" },
  { id: "flux-dev", name: "FLUX Dev" },
  { id: "stable-diffusion-xl", name: "Stable Diffusion XL" },
  { id: "dalle-3", name: "DALL-E 3" },
]

const ASPECT_RATIOS = [
  { id: "1:1", name: "Square", value: "1:1" },
  { id: "16:9", name: "Landscape", value: "16:9" },
  { id: "9:16", name: "Portrait", value: "9:16" },
  { id: "4:3", name: "Classic", value: "4:3" },
  { id: "3:4", name: "Classic Portrait", value: "3:4" },
]

const STYLES = [
  { id: "none", name: "None" },
  { id: "photorealistic", name: "Photorealistic" },
  { id: "digital-art", name: "Digital Art" },
  { id: "anime", name: "Anime" },
  { id: "oil-painting", name: "Oil Painting" },
  { id: "watercolor", name: "Watercolor" },
  { id: "3d-render", name: "3D Render" },
  { id: "minimalist", name: "Minimalist" },
]

interface GeneratedImage {
  id: string
  url: string
  prompt: string
}

export function ImageStudio() {
  const [model, setModel] = useState(MODELS[0].id)
  const [aspectRatio, setAspectRatio] = useState(ASPECT_RATIOS[0].id)
  const [style, setStyle] = useState(STYLES[0].id)
  const [prompt, setPrompt] = useState("")
  const [variationCount, setVariationCount] = useState([2])
  const [isGenerating, setIsGenerating] = useState(false)
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([])

  const handleGenerate = async () => {
    if (!prompt.trim()) return

    setIsGenerating(true)
    try {
      const response = await fetch("/api/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          aspectRatio,
          style,
          prompt,
          count: variationCount[0],
        }),
      })

      if (!response.ok) throw new Error("Generation failed")

      const data = await response.json()
      setGeneratedImages(data.images)
    } catch (error) {
      console.error("[v0] Image generation error:", error)
    } finally {
      setIsGenerating(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2.5">
            <Bullet />
            Generation Settings
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 relative">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2.5">
              <Label htmlFor="model" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Model
              </Label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger id="model" className="bg-background/50 border-border/50 font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.id} value={m.id} className="font-mono">
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2.5">
              <Label htmlFor="aspect" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Aspect Ratio
              </Label>
              <Select value={aspectRatio} onValueChange={setAspectRatio}>
                <SelectTrigger id="aspect" className="bg-background/50 border-border/50 font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASPECT_RATIOS.map((ar) => (
                    <SelectItem key={ar.id} value={ar.id} className="font-mono">
                      {ar.name} ({ar.value})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2.5">
              <Label htmlFor="style" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Style
              </Label>
              <Select value={style} onValueChange={setStyle}>
                <SelectTrigger id="style" className="bg-background/50 border-border/50 font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STYLES.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="font-mono">
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2.5">
              <Label htmlFor="variations" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                Variations: {variationCount[0]}
              </Label>
              <Slider
                id="variations"
                min={1}
                max={4}
                step={1}
                value={variationCount}
                onValueChange={setVariationCount}
                className="pt-2"
              />
            </div>
          </div>

          <div className="mt-6 space-y-2.5">
            <Label htmlFor="prompt" className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
              Prompt
            </Label>
            <div className="flex gap-2.5">
              <Input
                id="prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the image you want to generate..."
                className="flex-1 bg-background/50 border-border/50 font-mono placeholder:text-muted-foreground/50"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    handleGenerate()
                  }
                }}
              />
              <Button
                onClick={handleGenerate}
                disabled={!prompt.trim() || isGenerating}
                className="shrink-0 bg-primary hover:bg-primary/90"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Generating
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4 mr-2" />
                    Generate
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {generatedImages.length > 0 && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2.5">
              <Bullet />
              Generated Images
            </CardTitle>
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-mono">
              {generatedImages.length} {generatedImages.length === 1 ? "Image" : "Images"}
            </span>
          </CardHeader>
          <CardContent className="flex-1 relative">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {generatedImages.map((image) => (
                <div
                  key={image.id}
                  className="group relative aspect-square overflow-hidden rounded-lg border border-border/50 bg-card/30"
                >
                  <img src={image.url || "/placeholder.svg"} alt={image.prompt} className="size-full object-cover" />
                  <div className="absolute inset-0 bg-background/80 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <Button size="sm" variant="secondary" asChild>
                      <a href={image.url} download>
                        <Download className="size-4 mr-2" />
                        Download
                      </a>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {generatedImages.length === 0 && !isGenerating && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Sparkles className="size-16 text-muted-foreground/20 mb-4" />
              <h3 className="text-xl font-mono text-foreground/80 mb-2 uppercase tracking-wider">Ready to Create</h3>
              <p className="text-xs md:text-sm text-muted-foreground max-w-md leading-relaxed font-mono">
                Configure your settings and enter a prompt to generate AI images
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
