# Immersive VR Exhibition Space: Scandinavian Architecture

## Design Philosophy
The architectural update introduces a deliberate contrast to the digital, computation-heavy visual state of the existing environment. By integrating Scandinavian architectural principles—characterized by clean lines, functional geometry, and raw, natural materials—the VR space grounds the user in a more tangible, physical environment. The space uses literal spatial definitions to guide the user naturally towards the interactive sound exhibits.

## Key Architectural Elements

### 1. Polished Concrete Grounding
The default infinite dark, reflective plane is replaced by a vast, polished concrete floor spanning `80x80` meters. This provides a diffuse, textured base layer that grounds the abstract particle arrays and glowing UI panels.

### 2. Massive Exposed Concrete Walls
Constructed from raw concrete (`MeshStandardMaterial` with high roughness `0.9` and low metalness `0.1`), these massive monolithic elements act as spatial anchors.
- A large backdrop wall `(50m x 14m)` anchors the overall space.
- Low partition walls `(12m x 4m)` frame the flow of the room, creating an open-plan gallery experience while establishing boundaries.

### 3. Light Wood Vertical and Horizontal Framing
Using a warm light wood tone (`color: 0xc4a482`, representing ash or birch), the wooden elements introduce warmth and verticality.
- **Support Pillars**: Robust square wooden columns `(0.8m x 12m)` support the implied volume of the space.
- **Slatted Ceiling**: A slatted wooden canopy stretches overhead. Floating `12m` high, a series of `40` wooden beams provide overhead rhythm and cast subtle shadows on the exhibits below, blending modern Nordic pavilions with open-air structures.

### 5. Minimalist Benches
To encourage contemplation of the spatial audio, simple seating has been introduced.
- **Form Factor**: Concrete brutalist base blocks paired with an overarching light wood slab.
- **Placement**: Positioned to define the viewing area around the central and peripheral artifact pedestals.

### 6. Warmer Organic Lighting
The overall gallery illumination has been slightly warmed (from pure white `0xffffff` to soft warm white `0xffeedd` and `0xfff5e6`). This shift complements the ash wood ceiling slats and softens the brutalist concrete structures.

## Interaction Design (WebXR)
- **Standardized VR Models**: Integrated `XRControllerModelFactory` and `XRHandModelFactory` aligning with standard Three.js WebXR patterns on GitHub. These dynamically load specific model assets that correspond to the user's physical VR hardware (e.g., Quest controllers, Index Knuckles) or render physical hand meshes if hand-tracking is active, providing tactile immersion.
- **Raycasting Mechanics**: A visual laser line guides selection interactions seamlessly with objects and spatial UI.

## Material Composition
- **Concrete (Polished & Raw)**: Used for floors, pedestals, and structural walls. It implies weight and permanence.
- **Ash / Birch Wood**: Used for defining the structural envelope without enclosing it, allowing the infinite void to persist outside the pavilion while feeling sheltered inside.
- **Digital Grid Overlay**: The original computational grid remains but is significantly reduced in opacity (`0.05`), acting as a subtle structural blueprint overlaid onto the physical concrete floor.
