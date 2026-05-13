---
name: frontend-design
description: Use when the user asks to build a web component, page, or application where design quality matters — creating UI, designing a feature screen, or producing production-grade frontend output that must avoid generic AI aesthetics.
---

# Frontend Design

## Overview

Build distinctive, production-grade frontend interfaces with intentional aesthetic direction. The goal is code that is visually memorable and context-specific — not the generic "AI slop" that all LLMs converge on by default.

## When to Use

- User asks to build a component, page, or application
- User wants a UI redesign or visual improvement
- Any frontend output that will be seen by real users

**When NOT to use:** Backend-only tasks, data pipelines, API routes, CLI tools with no UI.

## Design Thinking (Before Any Code)

Commit to a **bold aesthetic direction** first. Answer these before touching code:

| Question | Think About |
|----------|-------------|
| **Purpose** | What problem does this solve? Who uses it? |
| **Tone** | Pick one extreme and execute it fully (see Aesthetic Directions below) |
| **Constraints** | Framework, performance, accessibility requirements |
| **Differentiation** | What is the one thing someone will remember? |

**Core principle:** Intentionality matters, not intensity. Both bold maximalism and precise minimalism work — the failure mode is not committing to either.

## Aesthetic Directions

Pick one and go all-in. Use these as starting points, not labels:

> Brutally minimal · Maximalist chaos · Retro-futuristic · Organic/natural · Luxury/refined ·
> Playful/toy-like · Editorial/magazine · Brutalist/raw · Art deco/geometric · Soft/pastel · Industrial/utilitarian

Design something true to the context — not a copy of a style trend.

## Implementation Guidelines

### Typography
- Pick fonts that are characterful and distinctive — **not** Arial, Inter, Roboto, or system fonts
- Pair a display font with a refined body font
- Font choice sets the entire aesthetic tone — choose before anything else

### Color & Theme
- Use CSS variables for the full palette
- One dominant color + sharp accent outperforms evenly-distributed timid palettes
- Commit to a palette that is specific to the context, not generic

### Motion
- Prioritize CSS-only animations for HTML; Motion library for React
- **One well-orchestrated page load** (staggered reveals with `animation-delay`) > scattered micro-interactions
- Scroll-triggered reveals and surprise hover states over constant animation noise

### Spatial Composition
- Use unexpected layouts: asymmetry, overlap, diagonal flow, grid-breaking elements
- Choose either generous negative space **or** controlled density — not an uneasy mix of both

### Backgrounds & Visual Details
- Create atmosphere — gradient meshes, noise textures, geometric patterns, layered transparencies
- Apply dramatic shadows, decorative borders, grain overlays, custom cursors where appropriate
- Never default to flat solid background colors; build depth and context

## Quick Reference — Anti-Patterns

| Anti-pattern | Fix |
|-------------|-----|
| Inter / Space Grotesk / system font | Pick a characterful display font pair |
| Purple gradient on white background | Choose a palette specific to tone and context |
| Generic card grid layout | Break the grid — overlap, asymmetry, unexpected composition |
| Scattered micro-animations everywhere | One orchestrated reveal sequence on load |
| Same aesthetic every generation | Vary light/dark, font families, tones across generations |
| Simple code for a maximalist vision | Match implementation complexity to aesthetic ambition |
| Minimalist design that's just sparse | Restraint requires precision — spacing, typography, subtle shadow |

## Implementation Checklist

- [ ] Committed to one clear aesthetic direction
- [ ] Distinctive font pair chosen (not Inter/Roboto/Arial)
- [ ] CSS variables for color system
- [ ] At least one surprising spatial composition choice
- [ ] Background creates atmosphere, not flat color
- [ ] Animations are purposeful — 1–2 high-impact moments, not scattered
- [ ] Code complexity matches the aesthetic ambition

## Closing Note

Codex is capable of extraordinary creative work. Don't converge — commit fully to a distinctive vision. No two designs produced by this skill should look alike.
