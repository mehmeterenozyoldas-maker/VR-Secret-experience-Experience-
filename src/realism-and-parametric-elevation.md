# Spatial Realism & Elevated Parametric Architecture

This document tracks the advanced graphics, structural refinements, and tactile realism implemented within the interactive WebXR computational art museum. By blending naturalistic Scandinavian minimalism with mathematically generated physical forms, we create a visually realistic space that mirrors the generative art pieces on display.

---

## 1. Advanced Tactile Material Generators

To overcome the sterility of standard flat 3D shading, we implement in-engine **tactile canvas procedural texture and bump generators**. This allows the museum's surfaces to interact realistically with light sources depending on their concrete or timber properties:

### Raw Board-Formed Concrete Texture
- **Procedural Canvas**: A coordinate-based generator produces variable gray-tone aggregate stone chips, micro-crack crevices, and water stains.
- **Bump/Roughness Maps**: Joint-lines of structural shuttering boards are mapped alongside high-frequency noise. Direct spotlights produce soft tactile shadows on concrete pedestals and walls, bringing physical presence.

### Scandinavian Ash Wood Grain
- **Grain Simulation**: Longitudinal fibers are procedurally traced using offset high-frequency sine-wave functions to mimic the look of ash/birch timber.
- **High-Definition Shimmer**: The bump map causes the wooden canopy slats and sweeping acoustic baffles to catch golden, glancing highlights at glancing viewpoints.

### High-Gloss Polished Floor tiles
- **Scuffs & Joints**: Rather than a perfectly smooth surface, the floor features micro-scratch lines, scuff marks, and expansion joint lines.
- **Immersive Highlights**: Reflects glowing audio visualization rings, volumetric sky rays, and exhibits with flawless, non-uniform specular gloss.

---

## 2. Dynamic Realtime Water Reflection pool

A continuous, shallow obsidian water feature runs under the main display wall surfaces:
- **Physics Normal Modulation**: We construct a procedural water normal map that represents minor organic ripples.
- **Render-Loop Coordinates**: Inside the main animation loop, coordinates are offset dynamically based on delta-time vectors to represent continuous, lazy liquid ripple patterns.
- **Visual Depth**: The dark obsidian pool mirrors the undulating ceiling timber slatted canopy and glowing spatial pedestals.

---

## 3. Nordic Biophilic Accents

To balance brutalism with Nordic naturalism, we introduce minimalist, procedurally generated **biophilic plants**:
- **Design Structure**: Modern geometric, cylindrical hand-carved concrete planters sit near structural timber columns.
- **Branch/Leaf Generators**: Slender, branching birch stems holding offset minimalist leaves are procedurally crafted. This soft organic texture breaks up hard modern angles.

---

## 4. Atmospheric Sky Oculus & pillar Uplighting

Illumination is enhanced to provide deep spatial contrast and architectural volumetric shadow play:
- **Central Sky-Oculus**: A grand circular skylight opening is carved in the parametric ceiling. It is lined with an emissive white cloud-ring that acts as a downward volumetric skylight source.
- **Crisp Directional Sunlight**: A directional light positioned high above projects the intricate, undulating pattern of eighty ceiling timber slats directly onto the floor and partitions.
- **Pillar Uplights**: Local pointlights are nestled at the foot of each column, casting a warm golden gradient up the wooden pillars.
