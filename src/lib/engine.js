import * as THREE from 'three';
import { VRButton } from 'three/examples/jsm/webxr/VRButton.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import * as Tone from 'tone';

export function createXREngine(containerNode, onLoaded) {
    // --- GLOBAL STATE ---
    let scene, camera, renderer, cameraGroup, composer;
    let controllers = [];
    let raycaster;
    let leftWristHUD = null;
    let rightWristHUD = null;
    let fittingRoomMirrorMesh = null;
    let currentLightingMode = 'nordic';
    const engineWishlistItems = [];
    const interactablePanels = [];
    const exhibits = [];
    const wishlistMiniatures = []; // Array to hold animation targets
    const visualizerBars = []; // Holds references to physical 3D audio bars
    const windShaders = []; // Holds references to injected wind shaders
    
    // Lighting & Environment
    let bigWallMaterial;
    let hemiLight, ambientLight, topLight, dirLight;
    let waterNormalMap;
    let concreteTex, woodTex, myceliumTex, hmBrandingTex;
    let globalFocusMode = false;
    let currentActiveAnalyser = null; 
    let teleportMarker;

    // Visual Effects
    let particleSystem;
    const PARTICLE_COUNT = 1500; 

    // Audio System (SoundExplorer specific)
    let mainReverb;
    const audioNodes = []; 
    
    // Desktop Controls & State
    let isDragging = false, isPointerDown = false;
    let previousMousePosition = { x: 0, y: 0 };
    let targetCameraRotation = { x: 0, y: 0 }, currentCameraRotation = { x: 0, y: 0 };
    const mouse = new THREE.Vector2(0, 0); 

    // Interaction State & Physics Momentum
    let hoveredUIElement = null; 
    let draggedArtifact = null; 
    let activeSlider = null; 
    let activeTeleportAnim = null;
    const tossVelocity = new THREE.Vector2(0, 0);

    // Gaze Dwell Selection Parameters
    let lastHoveredItem = null;
    let dwellStartTime = 0;
    const DWELL_DURATION = 1200; // 1.2 seconds to auto-click
    
    // External listeners referencing
    let windowResizeListener, windowMouseDownListener, windowMouseMoveListener, windowMouseUpListener, windowClickListener;

    // Loading Manager with robust fallbacks to bypass blocking network states
    let hasLoaded = false;
    const triggerLoaded = () => {
        if (!hasLoaded) {
            hasLoaded = true;
            if (onLoaded) onLoaded();
        }
    };

    const manager = new THREE.LoadingManager();
    manager.onProgress = (url, itemsLoaded, itemsTotal) => {};
    manager.onLoad = function () {
        triggerLoaded();
    };
    manager.onError = function (url) {
        console.warn("Asset load failed or bypassed gracefully. URL:", url);
        triggerLoaded();
    };
    
    // Guarantee loading screen resolves within 2500ms under any network conditions
    setTimeout(triggerLoaded, 2500);
    
    const gltfLoader = new GLTFLoader(manager);
    const gltfCache = new Map();

    init();
    
    function init() {
        window.addEventListener("error", (e) => {
            const errDiv = document.createElement("div");
            errDiv.style.position = "absolute";
            errDiv.style.top = "10px";
            errDiv.style.left = "10px";
            errDiv.style.color = "red";
            errDiv.style.zIndex = "9999";
            errDiv.style.backgroundColor = "black";
            errDiv.innerText = e.message + " | " + e.filename + ":" + e.lineno;
            document.body.appendChild(errDiv);
        });
        
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0xdddddd);
        scene.fog = new THREE.FogExp2(0xdddddd, 0.025);

        cameraGroup = new THREE.Group();
        cameraGroup.position.set(0, 1.6, 0); 
        scene.add(cameraGroup);

        camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
        cameraGroup.add(camera);

        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.xr.enabled = true;
        renderer.xr.setFramebufferScaleFactor(2.0); 
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2; 
        
        const renderScene = new RenderPass(scene, camera);
        const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
        bloomPass.threshold = 0.2;
        bloomPass.strength = 1.0;
        bloomPass.radius = 0.5;
        
        composer = new EffectComposer(renderer);
        composer.addPass(renderScene);
        composer.addPass(bloomPass);

        containerNode.appendChild(renderer.domElement);
        
        // Add VR Button to container rather than body to isolate
        const vrButton = VRButton.createButton(renderer);
        vrButton.style.background = 'rgba(10, 12, 16, 0.8)';
        vrButton.style.border = '1px solid rgba(229, 0, 16, 0.3)';
        vrButton.style.color = '#E50010';
        vrButton.style.borderRadius = '8px';
        vrButton.style.padding = '14px 28px';
        vrButton.style.fontFamily = 'Inter, sans-serif';
        vrButton.style.fontWeight = '600';
        vrButton.style.letterSpacing = '1px';
        vrButton.style.backdropFilter = 'blur(10px)';
        vrButton.style.bottom = '40px';
        vrButton.style.zIndex = '999';
        
        containerNode.appendChild(vrButton);

        renderer.xr.addEventListener('sessionstart', () => {
            // Keep renderer.shadowMap.enabled = true to avoid destroying WebGL compiled shader programs at runtime!
            // Instead, disable castShadow on lights to double VR framerate elegantly without compiling errors.
            scene.traverse(child => {
                if (child.isLight) {
                    if (child.castShadow) {
                        child.userData.wasCastingShadow = true;
                        child.castShadow = false;
                    }
                }
            });
            window.dispatchEvent(new CustomEvent('hm-telemetry', { detail: { action: 'SYSTEM', item: 'VR Session Started' } }));
        });

        renderer.xr.addEventListener('sessionend', () => {
            // Restore shadow casting on lights for high quality desktop viewport
            scene.traverse(child => {
                if (child.isLight && child.userData.wasCastingShadow) {
                    child.castShadow = true;
                }
            });
            window.dispatchEvent(new CustomEvent('hm-telemetry', { detail: { action: 'SYSTEM', item: 'VR Session Ended' } }));
            window.dispatchEvent(new CustomEvent('xr-session-ended'));
        });

        concreteTex = createConcreteTextures();
        woodTex = createWoodTextures();
        myceliumTex = createMyceliumTextures();
        hmBrandingTex = createHMBrandingBumpMap();

        setupLightingAndEnvironment();
        buildGallerySpace();
        initParticleSystem();
        buildMainSpatialTitle();

        // Setup Teleport Marker
        teleportMarker = new THREE.Mesh(
            new THREE.TorusGeometry(0.3, 0.05, 12, 32),
            new THREE.MeshBasicMaterial({ color: 0xe50010, transparent: true, opacity: 0.8 })
        );
        teleportMarker.rotation.x = -Math.PI / 2;
        teleportMarker.position.y = 0.02; // Slightly above floor
        teleportMarker.visible = false;
        scene.add(teleportMarker);

        // Define Data Schema for Virtual Artifacts
        const artifactSchema = [
            {
                id: "corset_1890",
                title: "1890s Avant-Garde Corset",
                description: "Open source museum resource. A radical Victorian piece featuring intricate threading, metal boning, and bold structural silhouettes pushing the boundaries of 19th century fashion.",
                url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Corset/glTF-Binary/Corset.glb',
                scale: 20.0,
                position: new THREE.Vector3(-3.4, 0, -2.5),
                rotationY: Math.PI / 6.5
            },
            {
                id: "corset_court",
                title: "Court Silhouette Bodice",
                description: "Curated historical garment. This piece laid the foundation for modern haute couture with its exaggerated hour-glass structuring.",
                url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Corset/glTF-Binary/Corset.glb',
                scale: 18.0,
                position: new THREE.Vector3(0, 0, -4.2),
                rotationY: 0
            },
            {
                id: "vintage_shoe",
                title: "Vintage Haute Slipper",
                description: "Archival footwear from early 20th century, representing the intersection of sportswear and avant-garde craftsmanship.",
                url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/MaterialsVariantsShoe/glTF-Binary/MaterialsVariantsShoe.glb',
                scale: 5.0,
                position: new THREE.Vector3(3.4, 0, -2.5),
                rotationY: -Math.PI / 6.5
            }
        ];

        // Load Exhibits from Schema
        artifactSchema.forEach(item => {
            let fallbackGen = null;
            if (item.id === "corset_1890") fallbackGen = createParametricGown;
            else if (item.id === "corset_court") fallbackGen = createCyberGown;
            else if (item.id === "vintage_shoe") fallbackGen = createOrreryArtifact;

            buildExhibit(
                loadGLTFArtifact(item.url, item.scale, fallbackGen),
                item.title,
                item.description,
                item.position,
                item.rotationY,
                item.id
            );
        });

        raycaster = new THREE.Raycaster();
        setupXRControllers();
        setupDesktopControls();
        
        windowResizeListener = onWindowResize;
        window.addEventListener('resize', windowResizeListener);
        
        // Ensure initial render triggers manager load check if nothing is loaded by GLTF
        setTimeout(() => {
           manager.itemStart('dummy');
           manager.itemEnd('dummy');
        }, 100);

        renderer.setAnimationLoop(render);
    }

    function initAudioSystem() {
        if (mainReverb) return; // Prevent double init
        mainReverb = new Tone.Reverb({ decay: 6, wet: 0.5 }).toDestination();
        Tone.Listener.upX.value = 0; Tone.Listener.upY.value = 1; Tone.Listener.upZ.value = 0;

        // Global Runway Beat + Ambience (Hype Techno)
        const kick = new Tone.MembraneSynth({ pitchDecay: 0.1, octaves: 5, oscillator: { type: "square" }, envelope: { attack: 0.001, decay: 0.4, sustain: 0.01, release: 1.4, attackCurve: "exponential" } }).connect(mainReverb);
        kick.volume.value = -6;
        
        const subBass = new Tone.Synth({ oscillator: { type: "sine" }, envelope: { attack: 0.1, decay: 0.3, sustain: 0.8, release: 0.8 } }).toDestination();
        subBass.volume.value = -10;

        const hat = new Tone.MetalSynth({ frequency: 200, envelope: { attack: 0.001, decay: 0.05, release: 0.01 }, harmonicity: 5.1, modulationIndex: 32, resonance: 4000, octaves: 1.5 }).connect(mainReverb);
        hat.volume.value = -20;
        
        const openHat = new Tone.MetalSynth({ frequency: 150, envelope: { attack: 0.01, decay: 0.4, release: 0.1 }, harmonicity: 4.1, modulationIndex: 20, resonance: 2000, octaves: 1.5 }).connect(mainReverb);
        openHat.volume.value = -22;

        const synthBass = new Tone.MonoSynth({ oscillator: { type: "sawtooth" }, filter: { Q: 2, type: "lowpass", rolloff: -24 }, envelope: { attack: 0.01, decay: 0.3, sustain: 0.1, release: 0.8 }, filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 0.1, release: 0.5, baseFrequency: 200, octaves: 3 } }).connect(mainReverb);
        synthBass.volume.value = -12;

        const cameraFlashSynth = new Tone.NoiseSynth({ noise: { type: "white" }, envelope: { attack: 0.005, decay: 0.8, sustain: 0, release: 0.1 } }).toDestination();
        cameraFlashSynth.volume.value = -14;

        Tone.Transport.bpm.value = 135; // Faster techno pace
        
        const clap = new Tone.NoiseSynth({ noise: { type: "pink" }, envelope: { attack: 0.001, decay: 0.3, sustain: 0, release: 0.1 } }).connect(mainReverb);
        clap.volume.value = -8;

        const beatLoop = new Tone.Sequence((time, step) => {
            // Hard industrial four on the floor
            if (step % 4 === 0) {
                kick.triggerAttackRelease("C1", "8n", time);
                subBass.triggerAttackRelease("C1", "8n", time);
            }
            
            // Clap on 2 and 4
            if (step === 4 || step === 12) {
                clap.triggerAttackRelease("8n", time);
            }
            
            // Driving hi-hats
            if (step % 2 !== 0) hat.triggerAttackRelease("32n", time, 0.6); // 16th notes
            if (step === 2 || step === 6 || step === 10 || step === 14) openHat.triggerAttackRelease("8n", time, 0.5); // Off-beat open hats

            // Dark pulsing bassline
            if (step === 0 || step === 3 || step === 8 || step === 11) synthBass.triggerAttackRelease("C2", "16n", time);
            if (step === 14 || step === 15) synthBass.triggerAttackRelease("Eb2", "16n", time);
            
            // Random camera flashes (paparazzi vibe)
            if (Math.random() > 0.85) {
                cameraFlashSynth.triggerAttackRelease("8n", time);
            }
        }, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], "16n");
        beatLoop.start(0);

        exhibits.forEach((artifact, index) => {
            const panel = interactablePanels[index];
            const exhibitId = panel && panel.userData ? panel.userData.exhibitId : index;
            const pos = artifact.userData.parentExhibit.position;
            
            const panner = new Tone.Panner3D({
                positionX: pos.x, positionY: pos.y + 1.5, positionZ: pos.z,
                panningModel: "HRTF", distanceModel: "exponential",
                refDistance: 1, maxDistance: 12, rolloffFactor: 1.5
            }).connect(mainReverb);

            const filter = new Tone.Filter(2000, "lowpass").connect(panner);
            const analyser = new Tone.Analyser("waveform", 256);
            const fft = new Tone.Analyser("fft", 32); 
            const meter = new Tone.Meter();
            let synth, loop;

            synth = new Tone.Noise("pink").start();
            synth.volume.value = -20;
            synth.connect(filter); synth.connect(analyser); synth.connect(fft); synth.connect(meter);
            
            loop = new Tone.Loop(time => {
                const freq = artifact.userData.sliders.freq || 0.5;
                const mod = artifact.userData.sliders.mod || 0.5;
                const space = artifact.userData.sliders.space || 0.5;
                
                // Modulate filter and volume based on panel sliders to add interaction to ambiance
                filter.frequency.value = 200 + mod * 4000;
                
                let vol = -25 + (space * 12);
                if (!artifact.userData.isRotating) {
                    vol -= 5;
                }
                synth.volume.value = vol;
            }, "10n");
            Tone.Transport.start(); loop.start(0);

            audioNodes.push({ exhibitId, panner, filter, analyser, fft, meter, synth, loop });
            artifact.userData.audioData = audioNodes[index];
        });
    }

    function triggerHapticPulse(controller, intensity = 0.5, duration = 50) {
        if (controller && controller.gamepad && controller.gamepad.hapticActuators && controller.gamepad.hapticActuators.length > 0) {
            controller.gamepad.hapticActuators[0].pulse(Math.min(1.0, intensity), duration);
        }
    }

    function triggerAudioHapticSync(controller, artifact) {
        if (controller.userData.grabbedObject === artifact && artifact.userData.audioData) {
            const db = artifact.userData.audioData.meter.getValue();
            const gain = Tone.dbToGain(db); 
            if (gain > 0.05) {
                triggerHapticPulse(controller, gain * 1.6, 15);
            }
        }
    }

    function createConcreteTextures() {
        const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#6e7377'; ctx.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 40000; i++) {
            const x = Math.random() * 512; const y = Math.random() * 512;
            const r = Math.random() * 1.5; ctx.fillStyle = Math.random() > 0.5 ? 'rgba(30, 32, 35, 0.15)' : 'rgba(255, 255, 255, 0.06)';
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)'; ctx.lineWidth = 2;
        for (let y = 128; y < 512; y += 128) {
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(512, y); ctx.stroke();
        }
        for (let i = 0; i < 6; i++) {
            const x = Math.random() * 512; const y = Math.random() * 512; const r = 30 + Math.random() * 50;
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, 'rgba(40, 42, 45, 0.12)'); grad.addColorStop(1, 'rgba(40, 42, 45, 0)');
            ctx.fillStyle = grad; ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        const map = new THREE.CanvasTexture(canvas); map.wrapS = THREE.RepeatWrapping; map.wrapT = THREE.RepeatWrapping; map.repeat.set(2, 2);

        // Bump Map
        const bCanvas = document.createElement('canvas'); bCanvas.width = 512; bCanvas.height = 512;
        const bCtx = bCanvas.getContext('2d'); bCtx.fillStyle = '#808080'; bCtx.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 50000; i++) {
            const x = Math.random() * 512; const y = Math.random() * 512; const r = Math.random() * 1.2;
            bCtx.fillStyle = Math.random() > 0.45 ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.06)';
            bCtx.beginPath(); bCtx.arc(x, y, r, 0, Math.PI * 2); bCtx.fill();
        }
        for (let y = 128; y < 512; y += 128) {
            bCtx.fillStyle = 'rgba(0,0,0,0.15)'; bCtx.fillRect(0, y, 512, 1);
            bCtx.fillStyle = 'rgba(255,255,255,0.08)'; bCtx.fillRect(0, y + 1, 512, 1);
        }
        const bumpMap = new THREE.CanvasTexture(bCanvas); bumpMap.wrapS = THREE.RepeatWrapping; bumpMap.wrapT = THREE.RepeatWrapping; bumpMap.repeat.set(2, 2);

        return { map, bumpMap };
    }

    function createWoodTextures() {
        const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#c4a482'; ctx.fillRect(0, 0, 512, 512);
        for (let x = 0; x < 512; x += 1.5) {
            const val = Math.sin(x * 0.05) * 10 + Math.cos(x * 0.01) * 30;
            const offset = Math.sin(val * 0.1) * 2;
            ctx.strokeStyle = Math.random() > 0.5 ? 'rgba(125, 95, 65, 0.15)' : 'rgba(235, 215, 185, 0.12)';
            ctx.lineWidth = 1 + Math.random() * 1.5;
            ctx.beginPath(); ctx.moveTo(x + offset, 0); ctx.lineTo(x + offset, 512); ctx.stroke();
        }
        for (let i = 0; i < 3; i++) {
            const cx = 100 + Math.random() * 312; const cy = 100 + Math.random() * 312;
            for (let r = 5; r < 50; r += 5) {
                ctx.strokeStyle = 'rgba(125, 95, 65, 0.06)'; ctx.lineWidth = 1.2;
                ctx.beginPath(); ctx.ellipse(cx, cy, r * 0.35, r, 0, 0, Math.PI * 2); ctx.stroke();
            }
        }
        const map = new THREE.CanvasTexture(canvas); map.wrapS = THREE.RepeatWrapping; map.wrapT = THREE.RepeatWrapping; map.repeat.set(1, 4);

        // Bump
        const bCanvas = document.createElement('canvas'); bCanvas.width = 512; bCanvas.height = 512;
        const bCtx = bCanvas.getContext('2d'); bCtx.fillStyle = '#808080'; bCtx.fillRect(0, 0, 512, 512);
        for (let x = 0; x < 512; x += 3) {
            const val = Math.sin(x * 0.05) * 10 + Math.cos(x * 0.01) * 30;
            const offset = Math.sin(val * 0.1) * 2;
            bCtx.strokeStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
            bCtx.lineWidth = 1;
            bCtx.beginPath(); bCtx.moveTo(x + offset, 0); bCtx.lineTo(x + offset, 512); bCtx.stroke();
        }
        const bumpMap = new THREE.CanvasTexture(bCanvas); bumpMap.wrapS = THREE.RepeatWrapping; bumpMap.wrapT = THREE.RepeatWrapping; bumpMap.repeat.set(1, 4);

        return { map, bumpMap };
    }

    function createMyceliumTextures() {
        const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f2f0e6'; // Off-white organic base
        ctx.fillRect(0, 0, 512, 512);
        
        // Procedural fungal network pattern
        for (let i = 0; i < 60000; i++) {
            const x = Math.random() * 512; const y = Math.random() * 512;
            const r = Math.random() * 2.0; 
            ctx.fillStyle = Math.random() > 0.5 ? 'rgba(215, 212, 198, 0.2)' : 'rgba(255, 255, 255, 0.4)';
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
        
        // Fibrous connections
        ctx.strokeStyle = 'rgba(215, 212, 198, 0.15)'; ctx.lineWidth = 0.5;
        for (let i = 0; i < 2000; i++) {
            const x = Math.random() * 512; const y = Math.random() * 512;
            const angle = Math.random() * Math.PI * 2; const len = 5 + Math.random() * 15;
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(angle)*len, y + Math.sin(angle)*len); ctx.stroke();
        }

        const map = new THREE.CanvasTexture(canvas); map.wrapS = THREE.RepeatWrapping; map.wrapT = THREE.RepeatWrapping; map.repeat.set(3, 3);

        const bCanvas = document.createElement('canvas'); bCanvas.width = 512; bCanvas.height = 512;
        const bCtx = bCanvas.getContext('2d'); bCtx.fillStyle = '#808080'; bCtx.fillRect(0, 0, 512, 512);
        for (let i = 0; i < 60000; i++) {
            const x = Math.random() * 512; const y = Math.random() * 512; const r = Math.random() * 2.0;
            bCtx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)';
            bCtx.beginPath(); bCtx.arc(x, y, r, 0, Math.PI * 2); bCtx.fill();
        }
        const bumpMap = new THREE.CanvasTexture(bCanvas); bumpMap.wrapS = THREE.RepeatWrapping; bumpMap.wrapT = THREE.RepeatWrapping; bumpMap.repeat.set(3, 3);

        return { map, bumpMap };
    }

    function createPolishedFloorTexture() {
        const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1024;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#1e2124'; ctx.fillRect(0, 0, 1024, 1024);
        ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2.0;
        for (let i = 0; i <= 1024; i += 256) {
            ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 1024); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(1024, i); ctx.stroke();
            ctx.fillStyle = 'rgba(0,0,0,0.35)';
            for (let j = 0; j <= 1024; j += 256) {
                ctx.beginPath(); ctx.arc(i + 8, j + 8, 4, 0, Math.PI * 2); ctx.fill();
            }
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.025)'; ctx.lineWidth = 0.5;
        for (let i = 0; i < 60; i++) {
            const x1 = Math.random() * 1024; const y1 = Math.random() * 1024;
            const len = 10 + Math.random() * 40; const angle = Math.random() * Math.PI * 2;
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + Math.cos(angle) * len, y1 + Math.sin(angle) * len); ctx.stroke();
        }
        const texture = new THREE.CanvasTexture(canvas); texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(10, 10);
        return texture;
    }

    function createPolishedFloorBumpMap() {
        const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 1024;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 1024, 1024);
        for (let i = 0; i < 40000; i++) {
            const x = Math.random() * 1024; const y = Math.random() * 1024; const r = Math.random() * 1.5;
            ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)';
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        for (let i = 0; i <= 1024; i += 256) {
            ctx.fillRect(i - 1, 0, 2, 1024); ctx.fillRect(0, i - 1, 1024, 2);
        }
        const texture = new THREE.CanvasTexture(canvas); texture.wrapS = THREE.RepeatWrapping; texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(10, 10);
        return texture;
    }

    function createWaterNormalMap() {
        const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#8080ff'; ctx.fillRect(0, 0, 256, 256);
        for (let i = 0; i < 200; i++) {
            const x = Math.random() * 256; const y = Math.random() * 256; const r = 10 + Math.random() * 30;
            const nx = 128 + Math.floor((Math.random() - 0.5) * 40);
            const ny = 128 + Math.floor((Math.random() - 0.5) * 40);
            const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
            grad.addColorStop(0, `rgba(${nx}, ${ny}, 255, 0.1)`); grad.addColorStop(1, 'rgba(128, 128, 255, 0)');
            ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
        const tex = new THREE.CanvasTexture(canvas); tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    // --- GLOBAL LIGHTS SET AT TOP ---

    function applyWindShader(material) {
        material.onBeforeCompile = (shader) => {
            shader.uniforms.windTime = { value: 0 };
            windShaders.push(shader);
            shader.vertexShader = `
                uniform float windTime;
            ` + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
                `#include <begin_vertex>`,
                `
                #include <begin_vertex>
                float wave = sin(position.y * 3.0 + windTime * 2.5) * 0.015 * step(0.1, position.y);
                transformed.x += wave;
                transformed.z += wave * 0.5;
                `
            );
        };
    }

    function createHMBrandingBumpMap() {
        const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d'); 
        ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 512, 512); // Neutral bump
        
        ctx.font = 'bold 180px "Inter", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        // White will be raised
        ctx.fillStyle = '#ffffff';
        ctx.fillText("H&M", 256, 256);
        
        // Add some noise
        for (let i = 0; i < 10000; i++) {
            const x = Math.random() * 512; const y = Math.random() * 512; const r = Math.random() * 1.5;
            ctx.fillStyle = Math.random() > 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.03)';
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }

        const tex = new THREE.CanvasTexture(canvas); tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
        return tex;
    }

    function createProceduralPottedTree() {
        const group = new THREE.Group();
        const potGeo = new THREE.CylinderGeometry(0.35, 0.28, 0.7, 24);
        const textures = createConcreteTextures();
        const potMat = new THREE.MeshStandardMaterial({ color: 0x8a8e92, roughness: 0.7, metalness: 0.1, map: textures.map, bumpMap: textures.bumpMap, bumpScale: 0.04 });
        const pot = new THREE.Mesh(potGeo, potMat); pot.position.y = 0.35; pot.castShadow = true; pot.receiveShadow = true; group.add(pot);
        
        const soilGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.05, 12);
        const soilMat = new THREE.MeshStandardMaterial({ color: 0x221a15, roughness: 0.9 });
        const soil = new THREE.Mesh(soilGeo, soilMat); soil.position.y = 0.68; group.add(soil);
        
        const trunkGeo = new THREE.CylinderGeometry(0.03, 0.05, 2.0, 8);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.8, metalness: 0.05 });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat); trunk.position.y = 1.68; trunk.castShadow = true; trunk.receiveShadow = true; group.add(trunk);
        
        for (let i = 0; i < 5; i++) {
            const ringGeo = new THREE.CylinderGeometry(0.041, 0.041, 0.03, 8);
            const ringMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.position.set(0, 1.0 + i * 0.35 + (Math.random() - 0.5) * 0.1, 0); ring.rotation.y = Math.random() * Math.PI * 2;
            group.add(ring);
        }
        
        const leafMat = new THREE.MeshStandardMaterial({ color: 0x5a755e, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide });
        const branchOffsets = [
            { x: 0.18, y: 2.0, z: 0.08, s: 0.4 },
            { x: -0.22, y: 2.2, z: -0.12, s: 0.35 },
            { x: 0.08, y: 2.4, z: -0.2, s: 0.45 },
            { x: -0.08, y: 2.6, z: 0.08, s: 0.38 },
            { x: 0.0, y: 2.85, z: 0.0, s: 0.52 }
        ];
        branchOffsets.forEach(b => {
            const twig = new THREE.Group(); twig.position.set(b.x, b.y, b.z);
            const cluster = new THREE.Mesh(new THREE.DodecahedronGeometry(b.s, 1), leafMat); cluster.castShadow = true; twig.add(cluster);
            const conGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.35); conGeo.rotateZ(Math.PI/4);
            const con = new THREE.Mesh(conGeo, trunkMat); con.position.set(-b.x * 0.5, -0.08, -b.z * 0.5); twig.add(con);
            group.add(twig);
        });
        return group;
    }

    function playUIFeedback(type) {
        if (Tone.context.state !== 'running') return;
        if (type === 'hover') {
            const s = new Tone.MembraneSynth().toDestination();
            s.volume.value = -32; s.triggerAttackRelease("D4", "32n");
        } else if (type === 'click') {
            const s = new Tone.MetalSynth().toDestination();
            s.volume.value = -28; s.triggerAttackRelease("16n");
        }
    }

    function setupLightingAndEnvironment() {
        // Dynamic Ambient Skybox
        const skyGeo = new THREE.SphereGeometry(80, 32, 15);
        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0xdce5eb) },
                bottomColor: { value: new THREE.Color(0xf5f5f0) },
                offset: { value: 33 },
                exponent: { value: 0.6 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                uniform float offset;
                uniform float exponent;
                varying vec3 vWorldPosition;
                void main() {
                    float h = normalize( vWorldPosition + offset ).y;
                    gl_FragColor = vec4( mix( bottomColor, topColor, max( pow( max( h , 0.0), exponent ), 0.0 ) ), 1.0 );
                }
            `,
            side: THREE.BackSide
        });
        const sky = new THREE.Mesh(skyGeo, skyMat);
        scene.add(sky);

        // Soft Nordic Ambient
        ambientLight = new THREE.AmbientLight(0xffeedd, 0.6); scene.add(ambientLight);
        
        // Hemisphere Light for soft gradient sky-to-ground bounce
        hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
        hemiLight.position.set(0, 20, 0);
        scene.add(hemiLight);

        // Core central soft box
        topLight = new THREE.PointLight(0xfff5e6, 0.8, 35);
        topLight.position.set(0, 7, 0); 
        topLight.castShadow = true; 
        topLight.shadow.mapSize.width = 1024; topLight.shadow.mapSize.height = 1024;
        topLight.shadow.bias = -0.002;
        scene.add(topLight);

        // Elegant Nordic Sun Directional Light to cast high-realism wood slat shadows
        dirLight = new THREE.DirectionalLight(0xfff6ee, 1.8);
        dirLight.position.set(10, 18, 5);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.near = 0.5;
        dirLight.shadow.camera.far = 45;
        dirLight.shadow.camera.left = -30;
        dirLight.shadow.camera.right = 30;
        dirLight.shadow.camera.top = 30;
        dirLight.shadow.camera.bottom = -30;
        dirLight.shadow.bias = -0.0005;
        scene.add(dirLight);

        const pmremGenerator = new THREE.PMREMGenerator(renderer);
        pmremGenerator.compileEquirectangularShader();
        
        const wallGeo = new THREE.CylinderGeometry(18, 18, 16, 80, 1, true, -Math.PI/1.3, Math.PI * 1.5);
        
        bigWallMaterial = new THREE.ShaderMaterial({
            uniforms: { 
                uTime: { value: 0.0 }, 
                uOpacity: { value: 0.8 },
                uAudioLevel: { value: 0.0 } 
            },
            side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `
                uniform float uTime; uniform float uOpacity; uniform float uAudioLevel; varying vec2 vUv;
                
                float random(in vec2 st) { return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123); }
                float noise(in vec2 st) {
                    vec2 i = floor(st); vec2 f = fract(st);
                    float a = random(i); float b = random(i + vec2(1.0, 0.0));
                    float c = random(i + vec2(0.0, 1.0)); float d = random(i + vec2(1.0, 1.0));
                    vec2 u = f*f*(3.0-2.0*f);
                    return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
                }
                float fbm(in vec2 st) {
                    float value = 0.0; float amplitude = 0.5;
                    for (int i = 0; i < 5; i++) { value += amplitude * noise(st); st *= 2.0; amplitude *= 0.5; }
                    return value;
                }

                void main() {
                    vec2 st = vUv * vec2(20.0, 8.0);
                    float t = uTime * 0.15;
                    float audioInfl = uAudioLevel * 2.5;

                    vec2 q = vec2(0.0);
                    q.x = fbm(st + vec2(t * 0.5, t * 0.2));
                    q.y = fbm(st + vec2(1.0));

                    vec2 r = vec2(0.0);
                    r.x = fbm(st + 4.0 * q + vec2(1.7, 9.2) + t * 1.2 + audioInfl);
                    r.y = fbm(st + 4.0 * q + vec2(8.3, 2.8) + t * 0.8 - audioInfl);

                    float f = fbm(st + 4.0 * r);

                    vec3 baseCol = vec3(0.01, 0.02, 0.05);
                    vec3 color = mix(baseCol, vec3(0.0, 0.2, 0.4), clamp((f*f)*4.0, 0.0, 1.0));
                    color = mix(color, vec3(0.0, 0.8, 1.0), clamp(length(q) * audioInfl * 0.8, 0.0, 1.0));
                    color = mix(color, vec3(0.6, 0.0, 1.0), clamp(length(r.x) * f, 0.0, 1.0));

                    float scanline = sin(vUv.y * 1200.0) * 0.04;
                    float glitch = step(0.98, random(vec2(uTime, vUv.y))) * audioInfl * 0.2;
                    
                    float fade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
                    gl_FragColor = vec4((color + scanline + glitch) * fade, fade * uOpacity); 
                }
            `
        });
        const wall = new THREE.Mesh(wallGeo, bigWallMaterial);
        wall.position.y = 5; scene.add(wall);
    }

    function buildGallerySpace() {
        // Floor - High Gloss Polished Concrete Style
        const floorTex = createPolishedFloorTexture();
        const floorBump = createPolishedFloorBumpMap();
        const floorGeo = new THREE.PlaneGeometry(100, 100);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x1c1e20,
            roughness: 0.05, // High gloss polished concrete
            metalness: 0.85,
            map: floorTex,
            bumpMap: floorBump,
            bumpScale: 0.002
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.name = 'teleportFloor';
        floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);

        // --- Scandinavian Architecture Materials with Tactile Grain ---
        const lightWoodMat = new THREE.MeshStandardMaterial({
            color: 0xc4a482,
            roughness: 0.6,
            metalness: 0.1,
            map: woodTex.map,
            bumpMap: woodTex.bumpMap,
            bumpScale: 0.012
        });
        const rawConcreteMat = new THREE.MeshStandardMaterial({
            color: 0x6e7377,
            roughness: 0.82,
            metalness: 0.12,
            map: concreteTex.map,
            bumpMap: concreteTex.bumpMap,
            bumpScale: 0.03
        });
        const myceliumMat = new THREE.MeshStandardMaterial({
            color: 0xf5f5f0,
            roughness: 0.95,
            metalness: 0.05,
            map: myceliumTex.map,
            bumpMap: myceliumTex.bumpMap,
            bumpScale: 0.04
        });

        const architectureGroup = new THREE.Group();

        // --- Center Runway Space ---
        const runwayGeo = new THREE.PlaneGeometry(8, 40);
        
        // --- Fitting Room Alcove (Spatial Cart) ---
        const alcoveGroup = new THREE.Group();
        alcoveGroup.position.set(-15, 0, 10);
        
        const alcoveFloor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), lightWoodMat);
        alcoveFloor.rotation.x = -Math.PI / 2;
        alcoveFloor.position.y = 0.05;
        alcoveFloor.receiveShadow = true;
        alcoveFloor.name = 'teleportFloor'; // Allow teleportation into fitting room
        alcoveGroup.add(alcoveFloor);
        
        const alcoveWall = new THREE.Mesh(new THREE.BoxGeometry(8, 4, 0.5), myceliumMat);
        alcoveWall.position.set(0, 2, 4.25);
        alcoveWall.receiveShadow = true;
        alcoveGroup.add(alcoveWall);
        
        // Fitting room soft warm lighting
        const alcoveLight = new THREE.PointLight(0xffddaa, 0.8, 10);
        alcoveLight.position.set(0, 3.5, 0);
        alcoveGroup.add(alcoveLight);
        
        const alcoveText = document.createElement('canvas');
        alcoveText.width = 1024; alcoveText.height = 256;
        const acx = alcoveText.getContext('2d');
        acx.fillStyle = '#ffffff'; acx.font = '300 80px "Inter"'; acx.textAlign = 'center';
        acx.letterSpacing = "10px";
        acx.fillText('FITTING ROOM', 512, 128);
        const alcoveTex = new THREE.CanvasTexture(alcoveText);
        const alcoveLabel = new THREE.Mesh(new THREE.PlaneGeometry(4, 1), new THREE.MeshBasicMaterial({map: alcoveTex, transparent: true}));
        alcoveLabel.position.set(0, 3, 3.9);
        alcoveLabel.rotation.y = Math.PI;
        alcoveGroup.add(alcoveLabel);
        
        architectureGroup.add(alcoveGroup);
        // Expose to global scope so we can add items to it
        window.fittingRoomGroup = alcoveGroup;
        window.fittingRoomItemMeshes = [];
        createFittingRoomMirror(alcoveGroup);

        const runwayMat = new THREE.MeshStandardMaterial({
            color: 0x050505,
            roughness: 0.1,
            metalness: 0.9,
            emissive: 0x111111,
            map: floorTex,
            bumpMap: floorBump,
            bumpScale: 0.005
        });
        const runway = new THREE.Mesh(runwayGeo, runwayMat);
        runway.name = 'teleportFloor'; // Allow teleportation
        runway.rotation.x = -Math.PI / 2;
        runway.position.set(0, 0.01, 5); // slightly above floor
        architectureGroup.add(runway);
        
        // Runway Light Strips
        const stripGeo = new THREE.PlaneGeometry(0.2, 40);
        const stripMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        const leftStrip = new THREE.Mesh(stripGeo, stripMat);
        leftStrip.rotation.x = -Math.PI / 2;
        leftStrip.position.set(-4, 0.02, 5);
        architectureGroup.add(leftStrip);
        const rightStrip = new THREE.Mesh(stripGeo, stripMat);
        rightStrip.rotation.x = -Math.PI / 2;
        rightStrip.position.set(4, 0.02, 5);
        architectureGroup.add(rightStrip);

        // 1. Massive Concrete Accent Wall (Backdrop)
        
        // H&M Branded Accent Matrix
        const hmBrandedWallMat = new THREE.MeshStandardMaterial({
            color: 0x6e7377,
            roughness: 0.8,
            metalness: 0.15,
            map: concreteTex.map,
            bumpMap: hmBrandingTex,
            bumpScale: -0.05 // recessed engraving
        });

        const backWallGeo = new THREE.BoxGeometry(60, 16, 1);
        const backWall = new THREE.Mesh(backWallGeo, hmBrandedWallMat);
        backWall.position.set(0, 8, -20);
        backWall.receiveShadow = true; backWall.castShadow = true;
        architectureGroup.add(backWall);

        // 1b. Acoustic Diffusor Wall Paneling
        const diffusorGroup = new THREE.Group();
        const numDiffusorSlats = 160;
        const panelWidth = 58; 
        for (let i = 0; i < numDiffusorSlats; i++) {
            const t = i / numDiffusorSlats;
            const xPos = -panelWidth/2 + t * panelWidth;
            
            const depth = 0.1 + Math.abs(Math.sin(i * 0.18) * 0.2 + Math.cos(i * 0.05) * 0.1);
            const height = 12.0 + Math.sin(i * 0.1) * 1.5;
            const slatGeo = new THREE.BoxGeometry(0.15, height, depth);
            const slat = new THREE.Mesh(slatGeo, lightWoodMat);
            
            slat.position.set(xPos, height/2, -19.4 + depth/2);
            slat.receiveShadow = true; slat.castShadow = true;
            diffusorGroup.add(slat);
        }
        architectureGroup.add(diffusorGroup);

        // 1c. Sustainable Mycelium Acoustic Array
        const myceliumGroup = new THREE.Group();
        const numMyceliumBaffles = 24;
        for (let i = 0; i < numMyceliumBaffles; i++) {
            const angle = (i / numMyceliumBaffles) * Math.PI * 2;
            const bRadius = 14; 
            const baffleGeo = new THREE.CylinderGeometry(0.8, 0.1, 4.0, 6);
            baffleGeo.rotateX(Math.PI / 2);
            const baffle = new THREE.Mesh(baffleGeo, myceliumMat);
            
            baffle.position.set(Math.cos(angle)*bRadius, 10.5, Math.sin(angle)*bRadius - 2);
            baffle.lookAt(0, 10.5, -2);
            baffle.castShadow = true; baffle.receiveShadow = true;
            myceliumGroup.add(baffle);
        }
        architectureGroup.add(myceliumGroup);

        // 2. Parametric Wooden Slatted Ceiling/Canopy
        const numSlats = 80;
        for (let i = 0; i < numSlats; i++) {
            const xPos = (i - numSlats/2) * 0.75;
            const isNearOculus = Math.abs(xPos) < 5.2;
            const waveOffset = Math.sin(i * 0.15) * 1.5 + Math.cos(i * 0.05) * 0.5;
            
            const slatHeight = isNearOculus ? 0.08 : (0.4 + Math.abs(waveOffset) * 0.5);
            const slatGeo = new THREE.BoxGeometry(0.12, slatHeight, 45);
            const slat = new THREE.Mesh(slatGeo, lightWoodMat);
            const yPos = isNearOculus ? (12.2 + waveOffset * 0.2) : (11.5 + waveOffset);
            slat.position.set(xPos, yPos, -2);
            slat.castShadow = true; slat.receiveShadow = true;
            architectureGroup.add(slat);
        }

        // 2b. Central Sky-Oculus (Skylight) and Parametric Chandelier
        const oculusGroup = new THREE.Group();
        oculusGroup.position.set(0, 12.0, -2);
        
        const oculusRingGeo = new THREE.TorusGeometry(5.2, 0.4, 16, 64);
        const oculusRing = new THREE.Mesh(oculusRingGeo, lightWoodMat);
        oculusRing.rotation.x = Math.PI / 2;
        oculusGroup.add(oculusRing);
        
        const skyGlowGeo = new THREE.CylinderGeometry(5.0, 5.0, 0.1, 64);
        const skyGlowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95 });
        const skyGlow = new THREE.Mesh(skyGlowGeo, skyGlowMat);
        skyGlow.position.y = 0.1;
        oculusGroup.add(skyGlow);

        // Parametric Chandelier
        const numChandelierRibs = 48;
        for (let i = 0; i < numChandelierRibs; i++) {
            const angle = (i / numChandelierRibs) * Math.PI * 2;
            const ribGeo = new THREE.BoxGeometry(0.04, 3.5, 0.12);
            const rib = new THREE.Mesh(ribGeo, lightWoodMat);
            
            const radius = 2.0; 
            rib.position.set(Math.cos(angle)*radius, -1.0, Math.sin(angle)*radius);
            
            rib.rotation.y = -angle;
            rib.rotation.x = Math.PI / 8; // Lean outward
            rib.rotation.z = Math.PI / 16; // Slight twist
            
            rib.castShadow = true;
            oculusGroup.add(rib);
        }
        
        architectureGroup.add(oculusGroup);

        // 3. Wooden Support Pillars with Foothill Uplights
        const pillarGeo = new THREE.BoxGeometry(0.8, 12, 0.8);
        const pillarPositions = [
            [-30, 6, -18], [30, 6, -18],
            [-30, 6, 15], [30, 6, 15],
            [-12, 6, 15], [12, 6, 15]
        ];
        pillarPositions.forEach(pos => {
            const pillar = new THREE.Mesh(pillarGeo, lightWoodMat);
            pillar.position.set(pos[0], pos[1], pos[2]);
            pillar.castShadow = true; pillar.receiveShadow = true;
            architectureGroup.add(pillar);

            const collarGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.12, 16);
            const collarMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.4, metalness: 0.8 });
            const collar = new THREE.Mesh(collarGeo, collarMat);
            collar.position.set(pos[0], 0.06, pos[2]);
            collar.castShadow = true; collar.receiveShadow = true;
            architectureGroup.add(collar);

            const warmUplight = new THREE.PointLight(0xffd5aa, 0.85, 12, 1.8);
            warmUplight.position.set(pos[0], 0.2, pos[2]);
            // PointLights with shadows are highly costly and deplete WebGL texture units, so we let accent lights bypass shadow calculation.
            architectureGroup.add(warmUplight);
        });

        // 4. Bioclimatic Parametric Timber Screen
        const numRibs = 80;
        
        // Left Bioclimatic Screen
        for (let i = 0; i < numRibs; i++) {
            const angle = (i / numRibs) * Math.PI * 0.5;
            const radius = 12 + Math.sin(i * 0.15) * 1.5; 
            const cx = -20;
            const cz = -10;
            
            // Computionally driven porosity using interference
            const interference = Math.sin(i * 0.2) * Math.cos(i * 0.08);
            const ribWidth = 0.04 + Math.abs(interference) * 0.18;
            const ribAngle = -angle + interference * Math.PI / 6;
            
            const ribGeo = new THREE.BoxGeometry(ribWidth, 4.5, 0.4);
            const rib = new THREE.Mesh(ribGeo, lightWoodMat);
            rib.position.set(cx + Math.cos(angle)*radius, 2.25, cz + Math.sin(angle)*radius);
            rib.rotation.y = ribAngle;
            rib.receiveShadow = true; rib.castShadow = true;
            architectureGroup.add(rib);
        }

        // Right Bioclimatic Screen
        for (let i = 0; i < numRibs; i++) {
            const angle = Math.PI - (i / numRibs) * Math.PI * 0.5;
            const radius = 12 + Math.sin(i * 0.15) * 1.5;
            const cx = 20;
            const cz = -10;
            
            const interference = Math.sin(i * 0.2) * Math.cos(i * 0.08);
            const ribWidth = 0.04 + Math.abs(interference) * 0.18;
            const ribAngle = -angle - interference * Math.PI / 6;
            
            const ribGeo = new THREE.BoxGeometry(ribWidth, 4.5, 0.4);
            const rib = new THREE.Mesh(ribGeo, lightWoodMat);
            rib.position.set(cx + Math.cos(angle)*radius, 2.25, cz + Math.sin(angle)*radius);
            rib.rotation.y = ribAngle;
            rib.receiveShadow = true; rib.castShadow = true;
            architectureGroup.add(rib);
        }

        // 5. Topographic Slatted Seating
        const benchPoints = [
            { x: -10, z: -4, rot: Math.PI / 4 },
            { x: 10, z: -4, rot: -Math.PI / 4 },
            { x: 0, z: 8, rot: 0 }
        ];

        const createTopographicBench = () => {
            const benchGroup = new THREE.Group();
            const numRibs = 36;
            const benchWidth = 3.6;
            const spacing = benchWidth / numRibs;
            for (let i = 0; i < numRibs; i++) {
                const xOffset = (i - numRibs/2) * spacing;
                const t = i / (numRibs - 1); // 0 to 1
                
                // Ergonomic wave: high at ends, dipping into a seat in the middle
                // We use a cosine wave shaped to create a slight dip in the middle.
                const waveHeight = Math.cos((t - 0.5) * Math.PI * 2) * -0.5 + 0.5; // 0 at edges, 1 in center => dip
                
                // Seat profile height variation
                const height = 0.45 - waveHeight * 0.1; 
                const depth = 0.8 + waveHeight * 0.2; // Widen in the middle
                
                // Rounded tops would be nice, but we use BoxGeometry for performance.
                const profileGeo = new THREE.BoxGeometry(spacing * 0.7, height, depth);
                const rib = new THREE.Mesh(profileGeo, lightWoodMat);
                
                rib.position.set(xOffset, height/2, Math.sin((t-0.5)*Math.PI) * 0.1); 
                rib.castShadow = true; rib.receiveShadow = true;
                benchGroup.add(rib);
                
                // Add a concrete base rail connecting the slats
                if (i === 0 || i === numRibs - 1) {
                    const solidBase = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.6), rawConcreteMat);
                    solidBase.position.set(xOffset, 0.15, 0);
                    solidBase.castShadow = true; solidBase.receiveShadow = true;
                    benchGroup.add(solidBase);
                }
            }
            
            // Central concrete spine
            const spineGeo = new THREE.BoxGeometry(benchWidth, 0.1, 0.4);
            const spine = new THREE.Mesh(spineGeo, rawConcreteMat);
            spine.position.y = 0.2;
            spine.castShadow = true; spine.receiveShadow = true;
            benchGroup.add(spine);
            
            return benchGroup;
        };

        benchPoints.forEach(pos => {
            const bench = createTopographicBench();
            bench.position.set(pos.x, 0, pos.z);
            bench.rotation.y = pos.rot;
            architectureGroup.add(bench);
        });

        // 6. Perimeter Water Channel & Reflection Pool
        const poolGroup = new THREE.Group();
        poolGroup.position.set(0, 0.01, -12);
        
        const rimGeo = new THREE.BoxGeometry(45, 0.15, 10);
        const rimMat = new THREE.MeshStandardMaterial({
            color: 0x3e4244,
            roughness: 0.7,
            metalness: 0.1,
            map: concreteTex.map,
            bumpMap: concreteTex.bumpMap,
            bumpScale: 0.04
        });
        const rim = new THREE.Mesh(rimGeo, rimMat);
        rim.receiveShadow = true; rim.castShadow = true;
        poolGroup.add(rim);
        
        const waterGeo = new THREE.PlaneGeometry(44.6, 9.6);
        const waterMat = new THREE.MeshStandardMaterial({
            color: 0x05080c,
            roughness: 0.08,
            metalness: 0.95,
            transparent: true,
            opacity: 0.9
        });
        
        waterNormalMap = createWaterNormalMap();
        waterNormalMap.repeat.set(4, 2);
        waterMat.normalMap = waterNormalMap;
        waterMat.normalScale.set(0.18, 0.18);
        
        const water = new THREE.Mesh(waterGeo, waterMat);
        water.rotation.x = -Math.PI / 2;
        water.position.y = 0.08;
        poolGroup.add(water);
        
        architectureGroup.add(poolGroup);
        
        // 6b. Ultra-Thin Floating Cantilevered Walkways over Water
        const walkwayGroup = new THREE.Group();
        walkwayGroup.position.set(0, 0.25, -12);
        
        const pathGeo = new THREE.BoxGeometry(4.5, 0.03, 10.4); 
        const pathMat = new THREE.MeshStandardMaterial({
            color: 0xdbdcdc, 
            roughness: 0.85,
            metalness: 0.1,
            bumpMap: concreteTex.bumpMap,
            bumpScale: 0.015
        });
        
        const path1 = new THREE.Mesh(pathGeo, pathMat);
        path1.position.set(-8, 0, 0);
        path1.castShadow = true; path1.receiveShadow = true;
        walkwayGroup.add(path1);
        
        const path2 = new THREE.Mesh(pathGeo, pathMat);
        path2.position.set(8, 0, 0);
        path2.castShadow = true; path2.receiveShadow = true;
        walkwayGroup.add(path2);

        architectureGroup.add(walkwayGroup);

        // 7. Biophilic Nordic Birch Potted Trees
        const plant1 = createProceduralPottedTree();
        plant1.position.set(-15, 0, 10);
        architectureGroup.add(plant1);

        const plant2 = createProceduralPottedTree();
        plant2.position.set(15, 0, 10);
        architectureGroup.add(plant2);

        scene.add(architectureGroup);
        // ------------------------------------------

        const gridHelper = new THREE.GridHelper(100, 150, 0xe50010, 0x004455);
        gridHelper.position.y = 0.01;
        gridHelper.material.opacity = 0.04; // Subtler grid against physical architecture
        gridHelper.material.transparent = true;
        gridHelper.material.depthWrite = false;
        scene.add(gridHelper);
    }

    function buildMainSpatialTitle() {
        const pr = 3;
        const canvas = document.createElement('canvas'); canvas.width = 1024 * pr; canvas.height = 512 * pr;
        const ctx = canvas.getContext('2d');
        ctx.scale(pr, pr);
        ctx.clearRect(0, 0, 1024, 512);
        ctx.fillStyle = '#ffffff'; ctx.font = '300 68px "Inter", sans-serif'; ctx.fillText("H&M VIRTUAL SHOWROOM", 0, 100);
        ctx.fillStyle = '#a0aab5'; ctx.font = '400 28px "Inter", sans-serif';
        wrapText(ctx, "Gaze and click interactive panels to browse the digital collection. Engage with spatial touch points to trigger fabric highlight lighting and detailed 3D inspection modes.", 0, 160, 900, 42);
        
        const texture = new THREE.CanvasTexture(canvas); texture.minFilter = THREE.LinearFilter;
        const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 1.5), mat);
        mesh.position.set(-3.6, 3.4, -3.8); mesh.rotation.y = Math.PI / 7;
        scene.add(mesh);
    }

    function initParticleSystem() {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(PARTICLE_COUNT * 3); 
        const colors = new Float32Array(PARTICLE_COUNT * 3);
        const sizes = new Float32Array(PARTICLE_COUNT);
        const vels = [];
        const phases = [];

        const colorTheme1 = new THREE.Color(0xe50010); // H&M Red
        const colorTheme2 = new THREE.Color(0xd4bc82); // Brass / Warm glow

        for(let i=0; i<PARTICLE_COUNT; i++) { 
            pos[i*3] = (Math.random() - 0.5) * 20; 
            pos[i*3+1] = Math.random() * 8; 
            pos[i*3+2] = (Math.random() - 0.5) * 20; 
            
            const mixRatio = Math.random();
            colors[i*3] = colorTheme1.r * mixRatio + colorTheme2.r * (1 - mixRatio);
            colors[i*3+1] = colorTheme1.g * mixRatio + colorTheme2.g * (1 - mixRatio);
            colors[i*3+2] = colorTheme1.b * mixRatio + colorTheme2.b * (1 - mixRatio);

            sizes[i] = Math.random() * 0.06 + 0.02;
            vels.push(new THREE.Vector3()); 
            phases.push(new THREE.Vector3(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2));
        }
        
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        
        const mat = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0.0 },
                uAudioLevel: { value: 0.0 }
            },
            vertexShader: `
                attribute float size;
                attribute vec3 color;
                varying vec3 vColor;
                uniform float uTime;
                uniform float uAudioLevel;
                void main() {
                    vColor = color;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    float sparkle = sin(uTime * 5.0 + position.x * 10.0) * 0.5 + 0.5;
                    gl_PointSize = size * (300.0 / -mvPosition.z) * (1.0 + uAudioLevel * 2.0 * sparkle);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `,
            fragmentShader: `
                varying vec3 vColor;
                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;
                    float alpha = smoothstep(0.5, 0.1, dist);
                    gl_FragColor = vec4(vColor * 1.5, alpha * 0.8);
                }
            `,
            transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
        });

        particleSystem = new THREE.Points(geo, mat); 
        particleSystem.userData.vels = vels; 
        particleSystem.userData.phases = phases;
        scene.add(particleSystem);
    }

    function triggerParticleBurst(origin, intensity = 1.0) {
        if(!particleSystem) return;
        const pos = particleSystem.geometry.attributes.position.array;
        const vels = particleSystem.userData.vels;
        const count = Math.floor((PARTICLE_COUNT * 0.4) * intensity);
        for(let i=0; i<count; i++) {
            pos[i*3] = origin.x + (Math.random() - 0.5) * 0.8;
            pos[i*3+1] = origin.y + (Math.random() - 0.5) * 0.8;
            pos[i*3+2] = origin.z + (Math.random() - 0.5) * 0.8;
            vels[i].set((Math.random() - 0.5) * 0.15, Math.random() * 0.2 * intensity, (Math.random() - 0.5) * 0.15);
        }
        particleSystem.geometry.attributes.position.needsUpdate = true;
    }

    function updateParticles(inspectedArtifact, timeSec) {
        if(!particleSystem) return;
        const pos = particleSystem.geometry.attributes.position.array;
        const vels = particleSystem.userData.vels;
        const phases = particleSystem.userData.phases;
        
        let currentDb = 0.0;
        if (currentActiveAnalyser && inspectedArtifact && inspectedArtifact.userData.audioData) {
             currentDb = Tone.dbToGain(inspectedArtifact.userData.audioData.meter.getValue());
        }

        for(let i=0; i<PARTICLE_COUNT; i++) {
            pos[i*3] += vels[i].x; 
            pos[i*3+1] += vels[i].y; 
            pos[i*3+2] += vels[i].z;
            
            if (inspectedArtifact) {
                const target = new THREE.Vector3(); inspectedArtifact.getWorldPosition(target);
                const pPos = new THREE.Vector3(pos[i*3], pos[i*3+1], pos[i*3+2]);
                const dir = new THREE.Vector3().subVectors(target, pPos);
                const dist = dir.length();
                
                if (dist > 0.05) {
                    dir.normalize();
                    const up = new THREE.Vector3(0, 1, 0);
                    const swirl = new THREE.Vector3().crossVectors(dir, up).multiplyScalar(0.04 + currentDb * 0.05);
                    vels[i].add(dir.multiplyScalar(0.005 + currentDb * 0.01)).add(swirl);
                }
                vels[i].multiplyScalar(0.92 - Math.min(0.1, currentDb));
            } else {
                const pX = pos[i*3]; const pY = pos[i*3+1]; const pZ = pos[i*3+2];
                const flowX = Math.sin(pZ * 0.15 + timeSec * 0.5 + phases[i].x) * 0.0005;
                const flowY = Math.cos(pX * 0.2 + timeSec * 0.4 + phases[i].y) * 0.0002;
                const flowZ = Math.sin(pY * 0.15 + timeSec * 0.6 + phases[i].z) * 0.0005;
                vels[i].add(new THREE.Vector3(flowX, flowY, flowZ));
                vels[i].y -= 0.00005; 
                vels[i].multiplyScalar(0.96);  // increased spatial dampening
            }

            if (pos[i*3+1] < 0) {
                pos[i*3+1] = 8 + Math.random() * 2;
                pos[i*3] = (Math.random() - 0.5) * 20;
                pos[i*3+2] = (Math.random() - 0.5) * 20;
                vels[i].set(0,0,0);
            } else if (pos[i*3+1] > 12) {
                pos[i*3+1] = 0;
            }
        }
        
        particleSystem.geometry.attributes.position.needsUpdate = true;
        if(particleSystem.material.uniforms) {
            particleSystem.material.uniforms.uTime.value = timeSec;
            particleSystem.material.uniforms.uAudioLevel.value += (currentDb - particleSystem.material.uniforms.uAudioLevel.value) * 0.1;
        }
    }

    function createParametricGown() {
        const group = new THREE.Group();
        const points = [];
        for ( let i = 0; i <= 20; i ++ ) {
            const t = i / 20;
            const radius = Math.sin(t * Math.PI) * 0.4 + Math.pow(1 - t, 2.5) * 0.7 + t * 0.15;
            points.push( new THREE.Vector2( radius * 0.9, t * 2.8 - 1.4 ) );
        }
        const geometry = new THREE.LatheGeometry( points, 64 );
        const material = new THREE.MeshStandardMaterial( { 
            color: 0xefefe9, 
            roughness: 0.9,
            metalness: 0.1,
            side: THREE.DoubleSide
        } );
        const dress = new THREE.Mesh( geometry, material );
        dress.castShadow = true;
        dress.receiveShadow = true;
        
        applyWindShader(material);
        
        const ringGeo = new THREE.TorusGeometry( 0.45, 0.03, 16, 64 );
        const ringMat = new THREE.MeshStandardMaterial({color: 0xe50010, roughness: 0.2, metalness: 0.8});
        const ring1 = new THREE.Mesh(ringGeo, ringMat);
        ring1.position.y = 0.5; ring1.rotation.x = Math.PI/6;
        dress.add(ring1);

        const ring2 = new THREE.Mesh(ringGeo, ringMat);
        ring2.position.y = -0.4; ring2.scale.set(1.6, 1.6, 1.6); ring2.rotation.x = -Math.PI/8;
        dress.add(ring2);

        group.add( dress );
        return group;
    }

    function createCyberGown() {
        const group = new THREE.Group();
        const geometry = new THREE.CylinderGeometry(0.3, 0.85, 2.5, 32, 16, true);
        const material = new THREE.MeshPhysicalMaterial({
            color: 0x111111,
            metalness: 0.9,
            roughness: 0.1,
            clearcoat: 1.0,
            clearcoatRoughness: 0.1,
            side: THREE.DoubleSide
        });
        const base = new THREE.Mesh(geometry, material);
        base.castShadow = true; base.receiveShadow = true;
        applyWindShader(material);
        
        const wireMat = new THREE.MeshBasicMaterial({color: 0xffffff, wireframe: true, transparent: true, opacity: 0.3});
        const exo = new THREE.Mesh(new THREE.TorusKnotGeometry(0.5, 0.12, 120, 16, 3, 7), wireMat);
        exo.position.y = 0.2;
        base.add(exo);

        group.add(base);
        return group;
    }

    function createOrreryArtifact() {
        const group = new THREE.Group();
        const sun = new THREE.Mesh(new THREE.SphereGeometry(0.12, 32, 32), new THREE.MeshStandardMaterial({ color: 0xffcc00, emissive: 0xffaa00, emissiveIntensity: 2 }));
        group.add(sun);
        const rings = [
            { radius: 0.25, speed: 0.02, size: 0.03, color: 0xe50010 },
            { radius: 0.45, speed: 0.01, size: 0.05, color: 0xff5555 },
            { radius: 0.65, speed: 0.006, size: 0.02, color: 0xcccccc }
        ];
        group.userData.planets = [];
        rings.forEach(data => {
            const path = new THREE.Mesh(new THREE.RingGeometry(data.radius - 0.003, data.radius + 0.003, 64), new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide, transparent: true, opacity: 0.5 }));
            path.rotation.x = Math.PI / 2; group.add(path);
            const pivot = new THREE.Group();
            const planet = new THREE.Mesh(new THREE.SphereGeometry(data.size, 32, 32), new THREE.MeshStandardMaterial({ color: data.color, roughness: 0.3, metalness: 0.2 }));
            planet.position.x = data.radius; planet.castShadow = true;
            pivot.add(planet); group.add(pivot);
            group.userData.planets.push({ pivot: pivot, speed: data.speed });
        });
        group.userData.animate = function(speedMult = 1.0) {
            if (group.userData.isRotating) {
                group.userData.planets.forEach(p => { p.pivot.rotation.y += p.speed * speedMult; });
                sun.rotation.y += 0.005 * speedMult;
            }
        };
        return group;
    }

    function createProceduralCamera() {
        const group = new THREE.Group();
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8, metalness: 0.3 });
        const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.4), bodyMat);
        body.castShadow = true; body.receiveShadow = true;
        group.add(body);

        const lensMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.9 });
        const lensRing = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.25, 32), lensMat);
        lensRing.rotation.x = Math.PI / 2;
        lensRing.position.set(0, 0, 0.2);
        lensRing.castShadow = true; lensRing.receiveShadow = true;
        group.add(lensRing);

        const glassMat = new THREE.MeshStandardMaterial({ color: 0xe50010, roughness: 0.05, metalness: 0.95 });
        const glass = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), glassMat);
        glass.position.set(0, 0, 0.3);
        group.add(glass);

        const dialMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.2, metalness: 0.8 });
        const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 16), dialMat);
        dial.position.set(0.25, 0.26, 0);
        dial.castShadow = true; dial.receiveShadow = true;
        group.add(dial);

        return group;
    }

    function createProceduralRelic() {
        const group = new THREE.Group();
        const coreMat = new THREE.MeshStandardMaterial({ color: 0xe50010, roughness: 0.1, metalness: 0.9, emissive: 0xaa0011, emissiveIntensity: 1.0 });
        const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), coreMat);
        core.castShadow = true; core.receiveShadow = true;
        group.add(core);

        const cageMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.3, metalness: 0.8 });
        const cageGeo = new THREE.DodecahedronGeometry(0.38, 0);
        const cage = new THREE.Mesh(cageGeo, cageMat);
        cage.material.wireframe = true;
        cage.castShadow = true; cage.receiveShadow = true;
        group.add(cage);

        const ringMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.2, metalness: 0.9 });
        const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.02, 8, 48), ringMat);
        ring1.rotation.y = Math.PI/4;
        group.add(ring1);

        const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.02, 8, 48), ringMat);
        ring2.rotation.x = Math.PI/3;
        group.add(ring2);

        return group;
    }

    function fetchGLTF(url) {
        if (gltfCache.has(url)) {
            return Promise.resolve(gltfCache.get(url));
        }

        return new Promise((resolve, reject) => {
            gltfLoader.load(url, (gltf) => {
                gltfCache.set(url, gltf);
                resolve(gltf);
            }, undefined, reject);
        });
    }

    function loadGLTFArtifact(url, scale, fallbackGenerator) {
        const group = new THREE.Group();
        const pivot = new THREE.Group(); group.add(pivot);
        group.userData.animate = function(speedMult = 1.0) {
            if (group.userData.isRotating) {
                if (group.userData.model) {
                    group.userData.model.rotation.y += 0.005 * speedMult;
                } else if (group.userData.fallback) {
                    group.userData.fallback.rotation.y += 0.005 * speedMult;
                    group.userData.fallback.rotation.x += 0.002 * speedMult;
                }
            }
        };

        fetchGLTF(url).then((gltf) => {
            const model = gltf.scene.clone(); model.scale.setScalar(scale);
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            model.position.sub(center); 
            model.traverse((child) => { 
                if (child.isMesh) { 
                    child.castShadow = true; 
                    child.receiveShadow = true; 
                    if (child.material) {
                        child.userData.originalMaterial = child.material.clone ? child.material.clone() : child.material;
                        applyWindShader(child.material);
                    }
                } 
            });
            pivot.add(model); group.userData.model = pivot;
        }).catch((err) => {
            console.warn("Failed to load GLTF model from", url, "- generating procedural fallback.", err);
            if (fallbackGenerator) {
                const fallback = fallbackGenerator();
                pivot.add(fallback);
                group.userData.fallback = fallback;
            }
        });

        return group;
    }

    function buildExhibit(artifactGroup, title, description, position, rotationY, exhibitId) {
        const exhibitGroup = new THREE.Group();
        exhibitGroup.position.copy(position); exhibitGroup.rotation.y = rotationY;
        scene.add(exhibitGroup);

        // Next-Level Parametric Scandinavian Diagrid Hyperboloid Stand Design
        const pedestalGroup = new THREE.Group();
        
        // Materials
        const scandWoodMat = new THREE.MeshStandardMaterial({
            color: 0xdec6af, // Warm, light birch timber
            roughness: 0.6,
            metalness: 0.08,
            map: woodTex.map,
            bumpMap: woodTex.bumpMap,
            bumpScale: 0.012
        });
        
        const topPlatterMat = new THREE.MeshStandardMaterial({
            color: 0xf5f5f0, // Sustainable off-white mycelium plate
            roughness: 0.8,
            metalness: 0.05,
            map: myceliumTex.map,
            bumpMap: hmBrandingTex,
            bumpScale: 0.04
        });
        
        const brassBaseMat = new THREE.MeshStandardMaterial({
            color: 0xd4bc82, // Brushed warm brass ring
            roughness: 0.15,
            metalness: 0.9,
            bumpMap: hmBrandingTex,
            bumpScale: 0.03
        });

        const glowColors = [0xe50010, 0x00aaff, 0xffaa44];
        const currentGlow = glowColors[exhibitId % glowColors.length];
        const coreGlowMat = new THREE.MeshStandardMaterial({
            color: currentGlow,
            emissive: currentGlow,
            emissiveIntensity: 1.4,
            transparent: true,
            opacity: 0.45,
            roughness: 0.15
        });

        const standHeight = 1.0;
        const rBottom = 0.44;
        const rTop = 0.36;
        const numSlatPairs = 12; // 24 slats total
        const twistAngle = Math.PI * 0.3; // Hyperboloid twist rotation offset (54 deg)

        // 1. Internal Glowing Core
        const coreGeo = new THREE.CylinderGeometry(0.16, 0.22, standHeight - 0.06, 32);
        const coreMesh = new THREE.Mesh(coreGeo, coreGlowMat);
        coreMesh.position.y = (standHeight - 0.06) / 2 + 0.03;
        pedestalGroup.add(coreMesh);

        // 1.5 Parametric Concrete Relief Base
        const baseConcreteMat = new THREE.MeshStandardMaterial({
            color: 0xd9d9d9, 
            roughness: 0.95,
            metalness: 0.05
        });
        
        // Stack a few fluted concrete discs to form a parametric plinth underneath
        for (let step = 0; step < 3; step++) {
            const discRadius = 0.58 + (2 - step) * 0.06;
            const thick = 0.05;
            const geo = new THREE.CylinderGeometry(discRadius, discRadius + 0.02, thick, 128, 1);
            const posAttr = geo.attributes.position;
            const numWaves = 48; // parametric fluting
            for (let i = 0; i < posAttr.count; i++) {
                const x = posAttr.getX(i);
                const y = posAttr.getY(i);
                const z = posAttr.getZ(i);
                // Only flute the outer rim, not the top/bottom flat faces deeply, though applying to all gives a nice raw edge
                const angle = Math.atan2(z, x);
                const r = Math.sqrt(x*x + z*z);
                if (r > discRadius - 0.1) { // Apply mainly to outer edge
                    const wave = Math.sin(angle * numWaves) * 0.006 * (Math.abs(y) > thick/2.1 ? 0.3 : 1.0); 
                    posAttr.setX(i, (r + wave) * Math.cos(angle));
                    posAttr.setZ(i, (r + wave) * Math.sin(angle));
                }
            }
            geo.computeVertexNormals();
            const disc = new THREE.Mesh(geo, baseConcreteMat);
            disc.position.y = thick / 2 + step * thick - 0.1; // Sits slightly below ground
            disc.receiveShadow = true; disc.castShadow = true;
            pedestalGroup.add(disc);
        }

        // 2. Brass Base Ring (Plinth)
        const plinthGeo = new THREE.CylinderGeometry(rBottom + 0.02, rBottom + 0.02, 0.04, 32);
        const plinthMesh = new THREE.Mesh(plinthGeo, brassBaseMat);
        plinthMesh.position.y = 0.02;
        plinthMesh.castShadow = true; plinthMesh.receiveShadow = true;
        pedestalGroup.add(plinthMesh);

        // 3. Diagrid Slats (Mathematical Hyperboloid double-ruled beams)
        const upVec = new THREE.Vector3(0, 1, 0);
        for (let i = 0; i < numSlatPairs; i++) {
            const theta = (i / numSlatPairs) * Math.PI * 2;
            
            // Slats can be constructed as thin slender wood beams
            const beams = [
                { twist: twistAngle },  // Clockwise slanting beam
                { twist: -twistAngle }  // Counter-clockwise slanting beam
            ];

            beams.forEach(b => {
                const start = new THREE.Vector3(
                    rBottom * Math.cos(theta),
                    0.03,
                    rBottom * Math.sin(theta)
                );
                const end = new THREE.Vector3(
                    rTop * Math.cos(theta + b.twist),
                    standHeight - 0.02,
                    rTop * Math.sin(theta + b.twist)
                );

                const beamDir = new THREE.Vector3().subVectors(end, start);
                const beamLen = beamDir.length();
                beamDir.normalize();

                const beamGeo = new THREE.BoxGeometry(0.018, beamLen, 0.035);
                const beamMesh = new THREE.Mesh(beamGeo, scandWoodMat);
                
                // Position at midpoint
                const midPoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
                beamMesh.position.copy(midPoint);
                
                // Rotate to align with the direction vector
                beamMesh.quaternion.setFromUnitVectors(upVec, beamDir);
                
                beamMesh.castShadow = true;
                beamMesh.receiveShadow = true;
                pedestalGroup.add(beamMesh);
            });
        }

        // 4. Sustainable Composted Mycelium Top Platter
        const topPlatterGeo = new THREE.CylinderGeometry(rTop + 0.04, rTop + 0.05, 0.03, 32);
        const topPlatterMesh = new THREE.Mesh(topPlatterGeo, topPlatterMat);
        topPlatterMesh.position.y = standHeight - 0.015;
        topPlatterMesh.castShadow = true; topPlatterMesh.receiveShadow = true;
        pedestalGroup.add(topPlatterMesh);

        exhibitGroup.add(pedestalGroup);

        // Gracious glowing orbit ring outlining the platter
        const pedLight = new THREE.Mesh(
            new THREE.RingGeometry(rTop + 0.01, rTop + 0.03, 64),
            new THREE.MeshBasicMaterial({ color: currentGlow, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
        );
        pedLight.rotation.x = -Math.PI / 2; pedLight.position.y = standHeight + 0.002;
        exhibitGroup.add(pedLight); exhibitGroup.userData.pedestalRing = pedLight.material; 

        const localBars = [];
        const numBars = 12;
        const barRadius = 0.52;
        for (let i = 0; i < numBars; i++) {
            const angle = (i / numBars) * Math.PI * 2;
            const barGeo = new THREE.BoxGeometry(0.04, 0.01, 0.04);
            const barMat = new THREE.MeshBasicMaterial({ color: currentGlow, transparent: true, opacity: 0.65 });
            const barMesh = new THREE.Mesh(barGeo, barMat);
            
            barMesh.position.set(Math.cos(angle) * barRadius, 1.02, Math.sin(angle) * barRadius);
            exhibitGroup.add(barMesh);
            localBars.push(barMesh);
        }
        visualizerBars.push({ exhibitId, bars: localBars });

        const artifactContainer = new THREE.Group();
        artifactContainer.add(artifactGroup);
        artifactContainer.position.set(0, 1.4, 0); 
        artifactContainer.userData = {
            isRotating: true, speedMultiplier: 1.0, 
            basePosition: new THREE.Vector3(0, 1.4, 0), targetPosition: new THREE.Vector3(0, 1.4, 0),
            isInspected: false, parentExhibit: exhibitGroup,
            sliders: { freq: 0.5, mod: 0.5, space: 0.5 },
            angularVelocity: new THREE.Vector2(0, 0) 
        };
        exhibitGroup.add(artifactContainer); exhibits.push(artifactContainer); 

        const spotLight = new THREE.SpotLight(0xffffff, 0.5); 
        spotLight.position.set(0, 4, 1.5); spotLight.angle = Math.PI / 4; spotLight.penumbra = 0.5;
        spotLight.target = artifactContainer; spotLight.castShadow = true;
        exhibitGroup.add(spotLight); artifactContainer.userData.spotLight = spotLight;

        const w = 1024, h = 680;
        const pr = 3;  // Increased pixel ratio for high resolution in VR
        const canvas = document.createElement('canvas'); canvas.width = w * pr; canvas.height = h * pr;
        const texture = new THREE.CanvasTexture(canvas); 
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;

        const uiData = {
            baseRotationY: -Math.PI / 6,
            exhibitId: exhibitId, artifact: artifactContainer,
            title: title, description: description,
            canvas: canvas, ctx: canvas.getContext('2d'), texture: texture,
            width: w, height: h, pixelRatio: pr, pointer: { x: w/2, y: h/2, active: false, targetTiltX: 0, targetTiltY: 0, currentTiltX: 0, currentTiltY: 0 }, hoveredItemId: null,
            interactables: [
                { type: 'button', id: 'mat1', x: 60, y: 310, w: 220, h: 60, text: 'Cotton' },
                { type: 'button', id: 'mat2', x: 300, y: 310, w: 220, h: 60, text: 'Poly' },
                { type: 'button', id: 'mat3', x: 540, y: 310, w: 220, h: 60, text: 'Knit' },
                { type: 'button', id: 'runway', x: 60, y: 390, w: 700, h: 60, text: 'SEND TO CENTER RUNWAY' },
                { type: 'button', id: 'toggle', x: 60, y: 470, w: 220, h: 60, text: 'Play/Pause' },
                { type: 'button', id: 'inspect', x: 300, y: 470, w: 220, h: 60, text: 'Inspect' },
                { type: 'button', id: 'reset', x: 540, y: 470, w: 220, h: 60, text: 'Return' },
                { type: 'button', id: 'wishlist', x: 60, y: 550, w: 700, h: 60, text: 'ADD TO WISHLIST & FITTING ROOM' },
                { type: 'slider', id: 'freq', x: 800, y: 130, w: 40, h: 480, value: 0.5, label: 'ROTATE' },
                { type: 'slider', id: 'mod', x: 870, y: 130, w: 40, h: 480, value: 0.5, label: 'LIGHT' },
                { type: 'slider', id: 'space', x: 940, y: 130, w: 40, h: 480, value: 0.5, label: 'GLOW' }
            ]
        };
        
        const panel = new THREE.Mesh(
            new THREE.PlaneGeometry(1.2, 0.7),
            new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.0, side: THREE.DoubleSide })
        );
        panel.position.set(1.2, 1.5, 0); panel.rotation.y = -Math.PI / 6;
        panel.scale.set(0.001, 0.001, 0.001);

        uiData.transitionProgress = 0.0;
        uiData.staggerTime = Date.now() + 400 + ((exhibits.length - 1) * 350);

        panel.userData = uiData;
        artifactContainer.userData.uiPanel = panel;
        drawUIPanel(panel, 0); exhibitGroup.add(panel); interactablePanels.push(panel);
    }

    function drawUIPanel(panelMesh, timeSec) {
        if (!panelMesh || !panelMesh.userData) return;
        if (panelMesh.userData.isMirror) {
            drawFittingRoomMirror();
            return;
        }
        const d = panelMesh.userData;
        if (!d.artifact || !d.artifact.userData) return;
        const ctx = d.ctx; const w = d.width; const h = d.height; const pr = d.pixelRatio || 1;
        const ptr = d.pointer;
        const audioData = d.artifact.userData.audioData;

        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

        ctx.save();
        ctx.scale(pr, pr);

        // Render Panel Backdrop
        ctx.beginPath();
        ctx.fillStyle = 'rgba(8, 10, 14, 0.4)'; 
        ctx.roundRect(0, 0, w, h, 36); 
        ctx.fill();

        ctx.save(); 
        ctx.beginPath();
        ctx.roundRect(0, 0, w, h, 36); 
        ctx.clip();

        if (audioData && audioData.analyser) {
            const values = audioData.analyser.getValue();
            ctx.beginPath();
            ctx.lineWidth = 4;
            ctx.strokeStyle = `hsla(${200 + d.artifact.userData.sliders.freq * 100}, 100%, 60%, 0.45)`;
            
            const sliceWidth = w * 0.75 / values.length;
            let x = 0;
            for (let i = 0; i < values.length; i++) {
                const v = values[i] * 120; 
                const y = h/2 + v;
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                x += sliceWidth;
            }
            ctx.stroke();
        }

        if (ptr.active) {
            let progressAngle = 0;
            if (lastHoveredItem && lastHoveredItem.panel === panelMesh) {
                const elapsed = performance.now() - dwellStartTime;
                progressAngle = Math.min(1, elapsed / DWELL_DURATION) * Math.PI * 2;
            }

            ctx.beginPath(); ctx.arc(ptr.x, ptr.y, 22 + Math.sin(timeSec * 12) * 4, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(229, 0, 16, 0.3)'; ctx.lineWidth = 2; ctx.stroke();
            
            if (progressAngle > 0) {
                ctx.beginPath(); ctx.arc(ptr.x, ptr.y, 26, -Math.PI / 2, -Math.PI / 2 + progressAngle);
                ctx.strokeStyle = 'rgba(229, 0, 16, 0.9)'; ctx.lineWidth = 3; ctx.stroke();
            }

            ctx.beginPath(); ctx.arc(ptr.x, ptr.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#00ffaa'; ctx.fill();
        }

        const uiGrad = ctx.createLinearGradient(0, 0, w * 0.8, 0);
        uiGrad.addColorStop(0, 'rgba(5, 6, 8, 0.95)'); uiGrad.addColorStop(0.8, 'rgba(5, 6, 8, 0.5)'); uiGrad.addColorStop(1, 'rgba(5, 6, 8, 0.0)');
        ctx.fillStyle = uiGrad; ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#ffffff'; ctx.font = '500 46px "Inter"'; ctx.fillText(d.title, 60, 90);
        ctx.fillStyle = '#e50010'; ctx.font = '600 18px "Inter"'; ctx.letterSpacing = "2px";
        ctx.fillText("H&M DIGITAL GARMENT", 60, 130);
        
        ctx.beginPath(); ctx.moveTo(60, 150); ctx.lineTo(w - 60, 150);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; ctx.stroke();

        ctx.fillStyle = '#cbd2dc'; ctx.font = '300 20px "Inter"'; ctx.letterSpacing = "0px";
        wrapText(ctx, d.description, 60, 200, 680, 28);

        d.interactables.forEach(item => {
            const isHovered = d.hoveredItemId === item.id;
            if (item.type === 'button') {
                ctx.beginPath();
                ctx.fillStyle = isHovered ? 'rgba(0,255,170,0.35)' : 'rgba(255,255,255,0.06)';
                ctx.roundRect(item.x, item.y, item.w, item.h, item.h / 2); ctx.fill();
                ctx.beginPath();
                ctx.roundRect(item.x, item.y, item.w, item.h, item.h / 2);
                ctx.strokeStyle = isHovered ? 'rgba(0,255,170,0.85)' : 'rgba(255,255,255,0.15)';
                ctx.lineWidth = 2; ctx.stroke();
                ctx.fillStyle = isHovered ? '#ffffff' : '#a0aab5';
                ctx.font = '500 22px "Inter"'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText(item.text, item.x + item.w/2, item.y + item.h/2);
            } else if (item.type === 'slider') {
                const currentVal = d.artifact.userData.sliders[item.id] !== undefined ? d.artifact.userData.sliders[item.id] : item.value;
                item.value = currentVal;

                ctx.beginPath();
                ctx.fillStyle = 'rgba(255,255,255,0.05)';
                ctx.roundRect(item.x, item.y, item.w, item.h, item.w / 2); ctx.fill();
                ctx.beginPath();
                ctx.roundRect(item.x, item.y, item.w, item.h, item.w / 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.stroke();
                
                const fillH = currentVal * item.h;
                let fillCol = isHovered || (activeSlider && activeSlider.item === item) ? 'rgba(0,255,170,0.9)' : 'rgba(0,255,170,0.45)';
                if(audioData && audioData.meter) {
                    const level = Tone.dbToGain(audioData.meter.getValue());
                    if (level > 0.08) fillCol = `rgba(229, 0, 16, ${Math.min(1.0, 0.5 + level * 2)})`;
                }
                
                if (fillH > 0) {
                    ctx.beginPath();
                    ctx.fillStyle = fillCol;
                    const radius = Math.min(item.w / 2, fillH / 2);
                    ctx.roundRect(item.x, item.y + item.h - fillH, item.w, fillH, radius); ctx.fill();
                }

                ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(item.x + item.w/2, item.y + item.h - fillH, item.w/2 + 3, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#a0aab5'; ctx.font = '600 14px "Inter"'; ctx.textAlign = 'center';
                ctx.fillText(item.label, item.x + item.w/2, item.y - 15);
            }
        });

        let explanationText = "";
        switch (d.hoveredItemId) {
            case 'mat1': explanationText = "Change fabric to Undyed Organic Cotton."; break;
            case 'mat2': explanationText = "Change fabric to Recycled Poly weave."; break;
            case 'mat3': explanationText = "Change fabric to Premium H&M Knitwear."; break;
            case 'runway': explanationText = "Spotlight this garment on the center runway stage."; break;
            case 'toggle': explanationText = "Play or pause the exhibit rotation."; break;
            case 'inspect': explanationText = "Bring garment close for detailed inspection."; break;
            case 'reset': explanationText = "Return garment to its original position."; break;
            case 'wishlist': explanationText = "Add to cart and view QR for physical fitting."; break;
            case 'freq': explanationText = "Adjust interaction frequency (rotation speed)."; break;
            case 'mod': explanationText = "Adjust focus lighting intensity."; break;
            case 'space': explanationText = "Adjust spatial synth ambiance presence."; break;
        }
        if (explanationText) {
            ctx.fillStyle = '#00ffaa'; ctx.font = '500 18px "Inter"'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            ctx.fillText("✓ " + explanationText, 60, 640);
        }

        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.restore(); 
        ctx.restore(); 
        d.texture.needsUpdate = true;
    }

    function wrapText(context, text, x, y, maxWidth, lineHeight) {
        const words = text.split(' '); let line = '';
        for(let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            if (context.measureText(testLine).width > maxWidth && n > 0) { context.fillText(line, x, y); line = words[n] + ' '; y += lineHeight; } 
            else line = testLine;
        }
        context.fillText(line, x, y);
    }

    function createWristHUD(controller) {
        const pr = 3;
        const w = 400, h = 500;
        const canvas = document.createElement('canvas');
        canvas.width = w * pr; canvas.height = h * pr;
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        
        const ctx = canvas.getContext('2d');
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(0.3, 0.375),
            new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9 })
        );
        
        // Position on wrist: rotate to face user when hand is raised
        plane.position.set(0, 0.05, 0.1);
        plane.rotation.x = -Math.PI / 2;
        
        plane.userData = { canvas, ctx, texture, width: w, height: h, pixelRatio: pr };
        leftWristHUD = plane;
        controller.add(plane);
        drawWristHUD(plane);
    }

    function drawWristHUD(plane) {
        if(!plane || !plane.userData) return;
        const d = plane.userData;
        const ctx = d.ctx; const w = d.width; const h = d.height; const pr = d.pixelRatio;
        
        ctx.clearRect(0, 0, w * pr, h * pr);
        ctx.save();
        ctx.scale(pr, pr);
        
        // Glassmorphic Base
        ctx.fillStyle = 'rgba(10, 12, 16, 0.6)';
        ctx.beginPath(); ctx.roundRect(0, 0, w, h, 20); ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.roundRect(0, 0, w, h, 20); ctx.stroke();
        
        ctx.fillStyle = '#ffffff'; ctx.font = '300 24px "Inter"'; ctx.letterSpacing = '2px';
        ctx.textAlign = 'center'; ctx.fillText('FITTING ROOM', w/2, 40);
        
        ctx.fillStyle = 'rgba(229, 0, 16, 0.8)';
        ctx.fillRect(w/2 - 20, 55, 40, 2);
        
        if (engineWishlistItems.length === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '400 16px "JetBrains Mono"';
            ctx.fillText('NO ITEMS SELECTED', w/2, h/2);
        } else {
            let y = 100;
            let total = 0;
            engineWishlistItems.slice(-4).forEach(item => { // Show last 4 items
                ctx.fillStyle = '#ffffff'; ctx.font = '500 14px "Inter"';
                ctx.textAlign = 'left';
                let shortName = item.name.length > 25 ? item.name.substring(0, 22) + '...' : item.name;
                ctx.fillText(shortName, 20, y);
                
                ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.font = '400 12px "JetBrains Mono"';
                ctx.fillText(item.material.toUpperCase(), 20, y + 20);
                
                ctx.fillStyle = '#ffaa00'; ctx.font = '500 14px "JetBrains Mono"';
                ctx.textAlign = 'right';
                ctx.fillText(item.price, w - 20, y + 10);
                
                ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(20, y + 35, w - 40, 1);
                
                total += parseInt(item.price.replace('$', ''));
                y += 60;
            });
            
            ctx.fillStyle = '#ffffff'; ctx.font = '300 18px "Inter"';
            ctx.textAlign = 'left'; ctx.fillText('EST. TOTAL', 20, h - 90);
            ctx.textAlign = 'right'; ctx.font = '500 18px "JetBrains Mono"'; ctx.fillText(`$${total}`, w - 20, h - 90);
            
            // Checkout button backdrop
            ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            ctx.beginPath(); ctx.roundRect(20, h - 70, w - 40, 50, 25); ctx.fill();
            ctx.fillStyle = '#ffffff'; ctx.font = '500 14px "Inter"'; ctx.textAlign = 'center';
            ctx.fillText('PROCEED TO CHECKOUT', w/2, h - 40);
        }
        
        ctx.restore();
        d.texture.needsUpdate = true;
    }

    function createFittingRoomMirror(alcoveGroup) {
        if (!alcoveGroup) return;
        const pr = 3;
        const w = 512, h = 1024;
        const canvas = document.createElement('canvas');
        canvas.width = w * pr; canvas.height = h * pr;
        const texture = new THREE.CanvasTexture(canvas);
        texture.minFilter = THREE.LinearFilter;
        
        const ctx = canvas.getContext('2d');
        const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(1.6, 3.2),
            new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.95, side: THREE.DoubleSide })
        );
        
        // Position on the back wall of the Fitting Room alcove
        plane.position.set(0, 1.8, 3.9);
        plane.rotation.y = Math.PI; // Face the interior
        
        plane.userData = { 
            baseRotationY: Math.PI,
            canvas, ctx, texture, width: w, height: h, pixelRatio: pr,
            isMirror: true,
            pointer: { x: w/2, y: h/2, active: false, targetTiltX: 0, targetTiltY: 0, currentTiltX: 0, currentTiltY: 0 },
            hoveredItemId: null,
            interactables: [
                { id: 'mirror_light_nordic', type: 'button', x: 50, y: 720, w: 412, h: 60, label: 'NORDIC DAYLIGHT' },
                { id: 'mirror_light_golden', type: 'button', x: 50, y: 800, w: 412, h: 60, label: 'GOLDEN HOUR GLOW' },
                { id: 'mirror_light_runway', type: 'button', x: 50, y: 880, w: 412, h: 60, label: 'RUNWAY SPOT' }
            ]
        };
        
        fittingRoomMirrorMesh = plane;
        alcoveGroup.add(plane);
        interactablePanels.push(plane);
        drawFittingRoomMirror();
        
        const backLight = new THREE.PointLight(0xffffff, 0.4, 6);
        backLight.position.set(0, 1.8, 4.0);
        alcoveGroup.add(backLight);
    }

    function drawFittingRoomMirror() {
        if(!fittingRoomMirrorMesh || !fittingRoomMirrorMesh.userData) return;
        const d = fittingRoomMirrorMesh.userData;
        const ctx = d.ctx; const w = d.width; const h = d.height; const pr = d.pixelRatio;
        const ptr = d.pointer;
        
        ctx.clearRect(0, 0, w * pr, h * pr);
        ctx.save();
        ctx.scale(pr, pr);
        
        // Base backing
        ctx.fillStyle = 'rgba(12, 16, 22, 0.85)';
        ctx.beginPath(); ctx.roundRect(0, 0, w, h, 24); ctx.fill();
        
        // LED light style based on active lighting
        let ledColor = 'rgba(255, 255, 255, 0.4)';
        const currentMode = currentLightingMode || 'nordic';
        if (currentMode === 'golden_hour') ledColor = 'rgba(255, 170, 85, 0.6)';
        else if (currentMode === 'runway') ledColor = 'rgba(229, 0, 16, 0.6)';
        
        ctx.strokeStyle = ledColor; ctx.lineWidth = 4;
        ctx.shadowColor = ledColor; ctx.shadowBlur = 15;
        ctx.beginPath(); ctx.roundRect(0, 0, w, h, 24); ctx.stroke();
        ctx.shadowBlur = 0;
        
        // Headers
        ctx.fillStyle = '#ffffff'; ctx.font = '300 24px "Inter"'; ctx.letterSpacing = '5px';
        ctx.textAlign = 'center'; ctx.fillText('H&M CLOUDTOPIA', w/2, 60);
        
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.font = '400 12px "JetBrains Mono"'; ctx.letterSpacing = '2px';
        ctx.fillText('SMART COUTURE MIRROR', w/2, 90);
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.1)'; ctx.fillRect(40, 110, w - 80, 2);
        
        // Items detection
        ctx.fillStyle = '#ffffff'; ctx.font = '300 18px "Inter"'; ctx.letterSpacing = '1px';
        ctx.textAlign = 'left'; ctx.fillText('FITTING ARCHIVE', 50, 150);
        
        ctx.font = '500 12px "JetBrains Mono"'; ctx.fillStyle = '#00ffaa';
        ctx.textAlign = 'right'; ctx.fillText(`${engineWishlistItems.length} ITEMS DETECTED`, w - 50, 150);
        
        if (engineWishlistItems.length === 0) {
            ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.font = '400 14px "JetBrains Mono"';
            ctx.textAlign = 'center'; ctx.fillText('No physical garments loaded.', w/2, 280);
            ctx.fillText('Select "ADD TO WISHLIST" in', w/2, 310);
            ctx.fillText('the main gallery to teleport them here.', w/2, 330);
        } else {
            let y = 190;
            engineWishlistItems.slice(-5).forEach(item => {
                ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.font = '500 14px "Inter"';
                ctx.textAlign = 'left';
                let shortName = item.name.length > 25 ? item.name.substring(0, 22) + '...' : item.name;
                ctx.fillText(shortName, 50, y);
                
                ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = '400 11px "JetBrains Mono"';
                ctx.fillText(`${item.material.toUpperCase()} EDITION`, 50, y + 18);
                
                ctx.fillStyle = '#ffffff'; ctx.font = '500 14px "JetBrains Mono"';
                ctx.textAlign = 'right'; ctx.fillText(item.price, w - 50, y + 10);
                
                ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fillRect(40, y + 30, w - 80, 1);
                y += 50;
            });
        }
        
        // Stylist advice
        const styleY = 460;
        ctx.fillStyle = 'rgba(255,255,255,0.03)'; ctx.fillRect(40, styleY, w - 80, 160);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; ctx.strokeRect(40, styleY, w - 80, 160);
        
        ctx.fillStyle = '#ffffff'; ctx.font = '600 12px "JetBrains Mono"'; ctx.textAlign = 'left';
        ctx.fillText('✦ STYLIST INSIGHT', 55, styleY + 30);
        
        ctx.fillStyle = 'rgba(255,255,255,0.65)'; ctx.font = '400 12px "Inter"';
        wrapText(ctx, "Silhouette Harmony: The drapes of the Undyed Organic Cotton pair perfectly with minimalist knit structures, accentuating geometric visual volume and high tactile depth under volumetric light.", 55, styleY + 60, w - 110, 20);
        
        // Interactive light hot spots
        ctx.fillStyle = '#ffffff'; ctx.font = '300 16px "Inter"'; ctx.textAlign = 'center';
        ctx.fillText('SELECT AMBIENCE SCENE', w/2, 690);
        
        d.interactables.forEach(item => {
            const isHovered = (d.hoveredItemId === item.id);
            ctx.fillStyle = isHovered ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.05)';
            ctx.beginPath(); ctx.roundRect(item.x, item.y, item.w, item.h, 10); ctx.fill();
            
            ctx.strokeStyle = isHovered ? '#00ffaa' : 'rgba(255, 255, 255, 0.15)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(item.x, item.y, item.w, item.h, 10); ctx.stroke();
            
            ctx.fillStyle = isHovered ? '#00ffaa' : '#ffffff'; ctx.font = '500 13px "JetBrains Mono"';
            ctx.textAlign = 'center'; ctx.fillText(item.label, item.x + item.w/2, item.y + 35);
        });
        
        if (ptr.active) {
            ctx.fillStyle = '#00ffaa'; ctx.strokeStyle = 'rgba(0, 255, 170, 0.5)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(ptr.x, ptr.y, 6, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(ptr.x, ptr.y, 14, 0, Math.PI * 2); ctx.stroke();
        }
        
        ctx.restore();
        d.texture.needsUpdate = true;
    }

    function spawnWishlistMiniature(artifact, controller) {
        if (!artifact.userData.model) return;
        
        const miniature = artifact.userData.model.clone();
        const holoMat = new THREE.MeshBasicMaterial({
            color: 0xff3300,
            transparent: true,
            opacity: 0.8,
            wireframe: true,
            blending: THREE.AdditiveBlending
        });
        miniature.traverse(c => {
            if (c.isMesh) c.material = holoMat;
        });
        
        // Scale down to a holographic orb
        miniature.scale.copy(artifact.scale).multiplyScalar(0.15);
        
        const worldPos = new THREE.Vector3();
        artifact.getWorldPosition(worldPos);
        miniature.position.copy(worldPos);
        
        scene.add(miniature);
        
        wishlistMiniatures.push({
            mesh: miniature,
            originalArtifact: artifact,
            progress: 0,
            controllerTarget: controller,
            startPos: worldPos.clone(),
            startScale: miniature.scale.clone()
        });
        
        try {
            const osc = new Tone.Oscillator(800, "square").toDestination();
            osc.volume.value = -10;
            osc.start().stop("+0.1");
            setTimeout(() => {
                const osc2 = new Tone.Oscillator(1200, "sine").toDestination();
                osc2.volume.value = -12;
                osc2.start().stop("+0.15");
            }, 100);
        } catch(e) {}
    }

    function setupXRControllers() {
        const controllerModelFactory = new XRControllerModelFactory();
        const handModelFactory = new XRHandModelFactory();

        for (let i = 0; i < 2; i++) {
            const controller = renderer.xr.getController(i);
            
            controller.addEventListener('connected', (event) => {
                const handedness = event.data.handedness;
                if (handedness === 'left' && !leftWristHUD) {
                    createWristHUD(controller);
                }
            });
            
            controller.addEventListener('selectstart', onSelectStart);
            controller.addEventListener('selectend', onSelectEnd);
            controller.addEventListener('squeezestart', onSqueezeStart);
            controller.addEventListener('squeezeend', onSqueezeEnd);
            scene.add(controller); controllers.push(controller);
            const geometry = new THREE.BufferGeometry().setFromPoints([ new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,-5) ]);
            const material = new THREE.LineBasicMaterial({ color: 0xffffff, opacity: 0.5, transparent: true });
            const line = new THREE.Line(geometry, material);
            line.name = 'line';
            controller.add(line);
            
            const curveGeo = new THREE.BufferGeometry().setFromPoints(new Array(20).fill(new THREE.Vector3()));
            const curveMat = new THREE.LineBasicMaterial({ color: 0x00aaff, opacity: 0.8, transparent: true, linewidth: 3 });
            const teleportLine = new THREE.Line(curveGeo, curveMat);
            teleportLine.name = 'teleportLine';
            teleportLine.visible = false;
            scene.add(teleportLine);
            
            controller.userData = { 
                isSelecting: false, 
                grabbedObject: null, 
                previousMatrix: new THREE.Matrix4(),
                teleportLine: teleportLine 
            };

            const controllerGrip = renderer.xr.getControllerGrip(i);
            controllerGrip.add( controllerModelFactory.createControllerModel( controllerGrip ) );
            scene.add( controllerGrip );

            const hand = renderer.xr.getHand(i);
            hand.add( handModelFactory.createHandModel( hand, 'mesh' ) );
            scene.add( hand );
        }
    }

    function setupDesktopControls() {
        windowMouseDownListener = (e) => {
            isPointerDown = true; previousMousePosition = { x: e.clientX, y: e.clientY };
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            raycaster.setFromCamera(mouse, camera);

            const uiHits = raycaster.intersectObjects(interactablePanels);
            if (uiHits.length > 0) {
                const hit = uiHits[0]; const panel = hit.object;
                const pixelX = hit.uv.x * panel.userData.width; const pixelY = (1 - hit.uv.y) * panel.userData.height;
                for (const item of panel.userData.interactables) {
                    if (item.type === 'slider' && pixelX >= item.x && pixelX <= item.x + item.w && pixelY >= item.y && pixelY <= item.y + item.h) {
                        activeSlider = { panel, item }; updateSliderValue(activeSlider, pixelY); return; 
                    }
                }
            }
            const intersects = raycaster.intersectObjects(exhibits, true);
            if (intersects.length > 0) {
                let root = intersects[0].object;
                while(root.parent && !exhibits.includes(root)) root = root.parent;
                if (exhibits.includes(root) && root.userData.isInspected) {
                    draggedArtifact = root; document.body.style.cursor = 'grabbing'; return; 
                }
            }
            isDragging = true;
        };
        
        windowMouseMoveListener = (e) => {
            mouse.x = (e.clientX / window.innerWidth) * 2 - 1; mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
            if (activeSlider) {
                raycaster.setFromCamera(mouse, camera); const uiHits = raycaster.intersectObject(activeSlider.panel);
                if (uiHits.length > 0) { const pixelY = (1 - uiHits[0].uv.y) * activeSlider.panel.userData.height; updateSliderValue(activeSlider, pixelY); }
                return;
            }
            const deltaX = e.clientX - previousMousePosition.x; const deltaY = e.clientY - previousMousePosition.y;
            if (draggedArtifact) { 
                draggedArtifact.rotation.y += deltaX * 0.008; draggedArtifact.rotation.x += deltaY * 0.008; 
                tossVelocity.set(deltaX * 0.002, deltaY * 0.002);
            }
            else if (isDragging && !renderer.xr.isPresenting) {
                targetCameraRotation.y -= deltaX * 0.0025; targetCameraRotation.x -= deltaY * 0.0025;
                targetCameraRotation.x = Math.max(-Math.PI/4, Math.min(Math.PI/4, targetCameraRotation.x));
            }
            previousMousePosition = { x: e.clientX, y: e.clientY };
        };
        
        windowMouseUpListener = () => {
            isPointerDown = false; activeSlider = null; isDragging = false;
            if (draggedArtifact) { 
                draggedArtifact.userData.angularVelocity.copy(tossVelocity);
                draggedArtifact = null; document.body.style.cursor = 'default'; 
            }
        };
        
        windowClickListener = () => { 
            if (renderer && !renderer.xr.isPresenting && !isDragging && !draggedArtifact && !activeSlider) executeHoveredAction(); 
        };

        window.addEventListener('mousedown', windowMouseDownListener);
        window.addEventListener('mousemove', windowMouseMoveListener);
        window.addEventListener('mouseup', windowMouseUpListener);
        window.addEventListener('click', windowClickListener);
    }

    function onSqueezeStart(event) {
        const controller = event.target;
        controller.userData.isTeleporting = true;
    }

    function onSqueezeEnd(event) {
        const controller = event.target;
        controller.userData.isTeleporting = false;
        if (controller.userData.teleportTarget && !activeTeleportAnim) {
            const headWorld = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
            const shiftX = controller.userData.teleportTarget.x - headWorld.x;
            const shiftZ = controller.userData.teleportTarget.z - headWorld.z;
            
            const startPos = cameraGroup.position.clone();
            const endPos = new THREE.Vector3(
                startPos.x + shiftX,
                controller.userData.teleportTarget.y + 1.6,
                startPos.z + shiftZ
            );
            
            activeTeleportAnim = {
                startTime: performance.now(),
                duration: 250, // ms
                startPos,
                endPos
            };
            
            triggerHapticPulse(controller, 0.8, 100);
            
            controller.userData.teleportTarget = null;
        }
        teleportMarker.visible = false;
    }

    function onSelectStart(event) {
        const controller = event.target; controller.userData.isSelecting = true;
        const tempMatrix = new THREE.Matrix4(); tempMatrix.identity().extractRotation(controller.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

        if (leftWristHUD) {
            const wristHits = raycaster.intersectObject(leftWristHUD);
            if (wristHits.length > 0) {
                const hit = wristHits[0];
                const uv = hit.uv;
                const pixelX = uv.x * leftWristHUD.userData.width;
                const pixelY = (1 - uv.y) * leftWristHUD.userData.height;
                
                // If clicked within the primary checkout button bounds (Proceed to checkout is at bottom)
                if (pixelX >= 20 && pixelX <= 380 && pixelY >= 430 && pixelY <= 480) {
                    playUIFeedback('click');
                    triggerHapticPulse(controller, 1.0, 100);
                    if (leftWristHUD.parent) {
                        triggerHapticPulse(leftWristHUD.parent, 1.0, 100);
                    }
                    
                    // Exit XR session gracefully to complete checkout on desktop
                    if (renderer.xr.getSession()) {
                        renderer.xr.getSession().end().then(() => {
                            window.dispatchEvent(new CustomEvent('hm-telemetry', { detail: { action: 'CHECKOUT_VR_START' } }));
                        });
                    }
                    return;
                }
            }
        }

        const uiHits = raycaster.intersectObjects(interactablePanels);
        if (uiHits.length > 0) {
            const panel = uiHits[0].object; const uv = uiHits[0].uv;
            const pixelX = uv.x * panel.userData.width; const pixelY = (1 - uv.y) * panel.userData.height;
            for (const item of panel.userData.interactables) {
                if (item.type === 'slider' && pixelX >= item.x && pixelX <= item.x + item.w && pixelY >= item.y && pixelY <= item.y + item.h) {
                    activeSlider = { panel, item, controller }; updateSliderValue(activeSlider, pixelY); return; 
                }
            }
        }
        const intersects = raycaster.intersectObjects(exhibits, true);
        if (intersects.length > 0) {
            let root = intersects[0].object; while(root.parent && !exhibits.includes(root)) root = root.parent;
            if (exhibits.includes(root) && root.userData.isInspected) {
                controller.userData.grabbedObject = root; controller.userData.previousMatrix.copy(controller.matrixWorld);
                triggerHapticPulse(controller, 1.0, 50); 
                return; 
            }
        }
        executeHoveredAction(controller);
    }

    function onSelectEnd(event) {
        const controller = event.target; controller.userData.isSelecting = false;
        if (controller.userData.grabbedObject) {
            controller.userData.grabbedObject.userData.angularVelocity.set(0.01 * (Math.random() - 0.5), 0.01 * (Math.random() - 0.5));
        }
        controller.userData.grabbedObject = null;
        if (activeSlider && activeSlider.controller === controller) activeSlider = null;
    }

    function updateSliderValue(sliderObj, pixelY) {
        const { item, panel } = sliderObj;
        let val = 1.0 - ((pixelY - item.y) / item.h); val = Math.max(0, Math.min(1, val));
        item.value = val;
        
        const artifact = panel.userData.artifact;
        artifact.userData.sliders[item.id] = val;

        if (item.id === 'freq') {
            artifact.userData.speedMultiplier = val * 2.5; // Rotate
        } else if (item.id === 'mod') {
            if (artifact.userData.spotLight) {
                // Light intensity
                artifact.userData.spotLight.intensity = val * 10.0;
            }
        } else if (item.id === 'space') {
            if (artifact.userData.spotLight) {
                // Light color setup (Warm to Cool / H&M Red focus)
                const targetColor = new THREE.Color(0xffffff).lerp(new THREE.Color(0xe50010), val);
                artifact.userData.spotLight.color = targetColor;
            }
        }
    }
     function updateHoverStates(origins) {
        let newlyHoveredPanel = null; let newlyHoveredItemId = null;
        let hoveringControllerIndex = -1;
        for (let i = 0; i < origins.length; i++) {
            raycaster.ray.copy(origins[i]); const intersects = raycaster.intersectObjects(interactablePanels);
            if (intersects.length > 0) {
                const hit = intersects[0]; const panel = hit.object;
                if (!panel || !panel.userData || !panel.userData.pointer || !panel.userData.interactables) continue;
                const pixelX = hit.uv ? hit.uv.x * panel.userData.width : panel.userData.width / 2;
                const pixelY = hit.uv ? (1 - hit.uv.y) * panel.userData.height : panel.userData.height / 2;
                panel.userData.pointer.x = pixelX; panel.userData.pointer.y = pixelY; panel.userData.pointer.active = true;
                
                const normalizedX = (pixelX / panel.userData.width) * 2 - 1;
                const normalizedY = -(pixelY / panel.userData.height) * 2 + 1;
                panel.userData.pointer.targetTiltX = normalizedY * 0.15; 
                panel.userData.pointer.targetTiltY = normalizedX * 0.15; 
 
                if (activeSlider && activeSlider.controller && activeSlider.panel === panel) updateSliderValue(activeSlider, pixelY);
                panel.userData.interactables.forEach(item => {
                    if (pixelX >= item.x && pixelX <= item.x + item.w && pixelY >= item.y && pixelY <= item.y + item.h) { 
                        newlyHoveredPanel = panel; 
                        newlyHoveredItemId = item.id; 
                        hoveringControllerIndex = i;
                    }
                });
                if (newlyHoveredPanel) break; 
            }
        }
        interactablePanels.forEach(panel => {
            if (!panel || !panel.userData || !panel.userData.pointer) return;
            const ptr = panel.userData.pointer;
            if (panel === newlyHoveredPanel) {
                if (panel.userData.hoveredItemId !== newlyHoveredItemId) {
                    panel.userData.hoveredItemId = newlyHoveredItemId;
                    if (newlyHoveredItemId) {
                        playUIFeedback('hover');
                        if (renderer.xr.isPresenting && hoveringControllerIndex !== -1) {
                            const controller = controllers[hoveringControllerIndex];
                            if (controller) {
                                triggerHapticPulse(controller, 0.4, 25);
                            }
                        }
                    }
                }
            } else { 
                panel.userData.hoveredItemId = null; ptr.active = false; 
                ptr.targetTiltX = 0; ptr.targetTiltY = 0; 
            }

            ptr.currentTiltX += (ptr.targetTiltX - ptr.currentTiltX) * 0.1;
            ptr.currentTiltY += (ptr.targetTiltY - ptr.currentTiltY) * 0.1;
            const baseRotY = (panel.userData && panel.userData.baseRotationY !== undefined) ? panel.userData.baseRotationY : -Math.PI / 6;
            panel.rotation.set(ptr.currentTiltX, baseRotY + ptr.currentTiltY, 0, 'YXZ');
        });

        const crosshairDOM = document.getElementById('crosshair-container');
        const loader = document.getElementById('gaze-loader');
        
        if (newlyHoveredItemId && newlyHoveredItemId !== 'freq' && newlyHoveredItemId !== 'mod' && newlyHoveredItemId !== 'space') {
            const currentItemKey = newlyHoveredPanel ? `${newlyHoveredPanel.uuid}_${newlyHoveredItemId}` : '';
            if (currentItemKey && lastHoveredItem && lastHoveredItem.key === currentItemKey) {
                const elapsed = performance.now() - dwellStartTime;
                if (loader) {
                    loader.style.opacity = '1';
                    loader.style.transform = `rotate(${(elapsed / DWELL_DURATION) * 360}deg)`;
                }
                if (elapsed >= DWELL_DURATION) {
                    executeHoveredAction();
                    lastHoveredItem = null; 
                    if (loader) loader.style.opacity = '0';
                }
            } else if (currentItemKey) {
                lastHoveredItem = { panel: newlyHoveredPanel, itemId: newlyHoveredItemId, key: currentItemKey };
                dwellStartTime = performance.now();
            } else {
                lastHoveredItem = null;
                if (loader) loader.style.opacity = '0';
            }
        } else {
            lastHoveredItem = null;
            if (loader) loader.style.opacity = '0';
        }

        hoveredUIElement = newlyHoveredPanel ? { panel: newlyHoveredPanel, itemId: newlyHoveredItemId } : null;
    }

    function executeHoveredAction(controller = null) {
        if (hoveredUIElement && hoveredUIElement.itemId) {
            const panelData = hoveredUIElement.panel ? hoveredUIElement.panel.userData : null;
            if (!panelData) return;
            if (panelData.isMirror) {
                playUIFeedback('click');
                if (controller) triggerHapticPulse(controller, 0.8, 20);
                
                const mode = hoveredUIElement.itemId.replace('mirror_light_', '');
                setLightingMode(mode);
                drawFittingRoomMirror();
                return;
            }
            
            const artifact = panelData.artifact;
            if (!artifact || !artifact.userData) return;
            const exhibit = artifact.userData.parentExhibit;
            const itemDef = panelData.interactables ? panelData.interactables.find(i => i.id === hoveredUIElement.itemId) : null;
            
            if (itemDef && itemDef.type === 'slider') return;
            playUIFeedback('click');
            if (controller) triggerHapticPulse(controller, 0.8, 20); 

            switch(hoveredUIElement.itemId) {
                case 'mat1': changeArtifactMaterial(artifact, 'cotton'); break;
                case 'mat2': changeArtifactMaterial(artifact, 'poly'); break;
                case 'mat3': changeArtifactMaterial(artifact, 'knit'); break;
                case 'toggle': artifact.userData.isRotating = !artifact.userData.isRotating; break;
                case 'wishlist':
                    triggerParticleBurst(artifact.position, 1.0);
                    
                    const matType = artifact.userData.currentMaterial || 'cotton';
                    const price = matType === 'cotton' ? '$85' : matType === 'poly' ? '$110' : '$145';
                    
                    const titleText = (artifact.userData.uiPanel && artifact.userData.uiPanel.userData) ? artifact.userData.uiPanel.userData.title : 'H&M Couture';
                    const addedItem = { 
                         id: Math.random().toString(), 
                         name: titleText, 
                         material: matType, 
                         price: price 
                    };
                    engineWishlistItems.push(addedItem);
                    
                    if (leftWristHUD) drawWristHUD(leftWristHUD);
                    
                    spawnWishlistMiniature(artifact, controller);
                    
                    window.dispatchEvent(new CustomEvent('hm-telemetry', { detail: { action: 'WISHLIST_ADD', item: titleText, fabric: matType, price: price } }));
                    break;
                case 'runway':
                    exhibits.forEach(ex => { if(ex && ex.userData && ex.userData.isInspected && ex !== artifact) resetArtifact(ex); });
                    artifact.userData.targetPosition.set(0, 1.4, 5); // Center runway position
                    artifact.userData.targetScale = new THREE.Vector3(2.5, 2.5, 2.5); // Scale up
                    artifact.userData.isInspected = true; 
                    if (exhibit && exhibit.userData && exhibit.userData.pedestalRing) {
                        exhibit.userData.pedestalRing.color.setHex(0xffaa00); exhibit.userData.pedestalRing.opacity = 0.8;
                    }
                    triggerParticleBurst(artifact.position, 1.5);
                    globalFocusMode = true; 
                    if (artifact.userData.spotLight) artifact.userData.spotLight.intensity = 8.0; 
                    if(artifact.userData.audioData) { currentActiveAnalyser = artifact.userData.audioData.analyser; }
                    break;
                case 'inspect':
                    if (!artifact.userData.isInspected) {
                        const inspectTitleText = (artifact.userData.uiPanel && artifact.userData.uiPanel.userData) ? artifact.userData.uiPanel.userData.title : 'H&M Couture';
                        window.dispatchEvent(new CustomEvent('hm-telemetry', { detail: { action: 'INSPECT', item: inspectTitleText } }));
                        exhibits.forEach(ex => { if(ex && ex.userData && ex.userData.isInspected && ex !== artifact) resetArtifact(ex); });
                        artifact.userData.targetPosition.set(-0.6, 1.2, 1.5); 
                        artifact.userData.targetScale = new THREE.Vector3(1.5, 1.5, 1.5);
                        artifact.userData.isInspected = true; 
                        if (exhibit && exhibit.userData && exhibit.userData.pedestalRing) {
                            exhibit.userData.pedestalRing.color.setHex(0xffaa00); exhibit.userData.pedestalRing.opacity = 0.8;
                        }
                        
                        triggerParticleBurst(artifact.position, 1.5);
                        globalFocusMode = true; 
                        if (artifact.userData.spotLight) artifact.userData.spotLight.intensity = 5.0; 
                        
                        if(artifact.userData.audioData) {
                            currentActiveAnalyser = artifact.userData.audioData.analyser;
                        }
                    }
                    break;
                case 'reset':
                    if (artifact.userData.isInspected) resetArtifact(artifact);
                    break;
            }
        }
    }

    function changeArtifactMaterial(artifact, matType) {
        if(!artifact || !artifact.userData || !artifact.userData.model) return;
        const model = artifact.userData.model;
        
        artifact.userData.currentMaterial = matType;
        
        // Show sustainability tag via particle burst / feedback
        triggerParticleBurst(artifact.position, 1.0);
        const textTitle = (artifact.userData.uiPanel && artifact.userData.uiPanel.userData) ? artifact.userData.uiPanel.userData.title : 'H&M Couture';
        window.dispatchEvent(new CustomEvent('hm-telemetry', { detail: { action: 'MATERIAL_SELECT', item: textTitle, fabric: matType } }));
        
        model.traverse((child) => {
            if(child.isMesh && child.userData.originalMaterial) {
                const orig = child.userData.originalMaterial;
                child.material = orig.clone();
                
                if (matType === 'cotton') {
                    child.material.color.setHex(0xefefe9); // Undyed Organic Cotton
                    child.material.roughness = 0.95;
                    child.material.metalness = 0.0;
                    if (artifact.userData.uiPanel && artifact.userData.uiPanel.userData) {
                        artifact.userData.uiPanel.userData.description = "Organic Cotton: Responsibly farmed without synthetic pesticides. High breathability and a natural, tactile softness for everyday wear. Supports sustainable agriculture and circular loops.";
                    }
                } else if (matType === 'poly') {
                    child.material.color.setHex(0x222222); // Recycled Poly
                    child.material.roughness = 0.2;
                    child.material.metalness = 0.6;
                    if (artifact.userData.uiPanel && artifact.userData.uiPanel.userData) {
                        artifact.userData.uiPanel.userData.description = "Recycled Polyester: Engineered from post-consumer PET bottles. Offers a sleek, highly durable tear-resistant weave with an iridescent gloss. Reduces landfill waste by over 45%.";
                    }
                } else if (matType === 'knit') {
                    child.material.color.setHex(0xe50010); // H&M Red Premium Knit
                    child.material.roughness = 0.85;
                    child.material.metalness = 0.1;
                    if(child.material.normalScale) {
                        child.material.normalScale.set(2.5, 2.5);
                    }
                    if (artifact.userData.uiPanel && artifact.userData.uiPanel.userData) {
                        artifact.userData.uiPanel.userData.description = "Premium Knitwear: Richly woven high-tension yarns dyed in signature H&M Red focus tones. Combines artisanal stitching with performance durability. Zero-chemical dye process.";
                    }
                }
                applyWindShader(child.material);
                child.material.needsUpdate = true;
            }
        });
    }

    function resetArtifact(artifact) {
        if (!artifact || !artifact.userData) return;
        const exhibit = artifact.userData.parentExhibit;
        artifact.userData.isRotating = true;
        if (artifact.userData.basePosition) artifact.userData.targetPosition.copy(artifact.userData.basePosition);
        artifact.userData.targetScale = new THREE.Vector3(1, 1, 1);
        artifact.userData.isInspected = false;
        if (exhibit && exhibit.userData && exhibit.userData.pedestalRing) {
            exhibit.userData.pedestalRing.color.setHex(0xe50010); exhibit.userData.pedestalRing.opacity = 0.2;
        }
        if (artifact.userData.spotLight) artifact.userData.spotLight.intensity = 0.5;
        if (!exhibits.some(ex => ex && ex.userData && ex.userData.isInspected)) {
            globalFocusMode = false;
            currentActiveAnalyser = null;
        }
    }

    function onWindowResize() {
        if (!camera || !renderer) return;
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix(); 
        renderer.setSize(window.innerWidth, window.innerHeight);
        if (composer) composer.setSize(window.innerWidth, window.innerHeight);
    }

    function render(time) {
        try {
            const timeSec = time * 0.001;

            if (activeTeleportAnim) {
                const now = performance.now();
                const elapsed = now - activeTeleportAnim.startTime;
                let t = elapsed / activeTeleportAnim.duration;
                if (t >= 1.0) {
                    t = 1.0;
                    cameraGroup.position.copy(activeTeleportAnim.endPos);
                    activeTeleportAnim = null;
                } else {
                    // Ease-out cubic
                    const easeOut = 1 - Math.pow(1 - t, 3);
                    cameraGroup.position.lerpVectors(activeTeleportAnim.startPos, activeTeleportAnim.endPos, easeOut);
                }
            }

            windShaders.forEach(s => s.uniforms.windTime.value = timeSec);

            if (waterNormalMap) {
                waterNormalMap.offset.x = timeSec * 0.015;
                waterNormalMap.offset.y = timeSec * 0.010;
            }

        if (!renderer.xr.isPresenting) {
            currentCameraRotation.x += (targetCameraRotation.x - currentCameraRotation.x) * 0.08;
            currentCameraRotation.y += (targetCameraRotation.y - currentCameraRotation.y) * 0.08;
            cameraGroup.rotation.set(currentCameraRotation.x, currentCameraRotation.y, 0, 'YXZ');
        }

        if (Tone.context.state === 'running') {
            const camPos = new THREE.Vector3(); camera.getWorldPosition(camPos);
            Tone.Listener.positionX.value = camPos.x;
            Tone.Listener.positionY.value = camPos.y;
            Tone.Listener.positionZ.value = camPos.z;

            const camDir = new THREE.Vector3(); camera.getWorldDirection(camDir);
            Tone.Listener.forwardX.value = camDir.x;
            Tone.Listener.forwardY.value = camDir.y;
            Tone.Listener.forwardZ.value = camDir.z;
        }

        const targetAmbient = globalFocusMode ? 0.05 : 0.4;
        const targetTop = globalFocusMode ? 0.2 : 1.0;
        ambientLight.intensity += (targetAmbient - ambientLight.intensity) * 0.05;
        topLight.intensity += (targetTop - topLight.intensity) * 0.05;

        if (bigWallMaterial) { 
            bigWallMaterial.uniforms.uTime.value = timeSec; 
            bigWallMaterial.uniforms.uOpacity.value += ((globalFocusMode ? 0.15 : 0.8) - bigWallMaterial.uniforms.uOpacity.value) * 0.05; 
            
            let ampValue = 0.0;
            if (currentActiveAnalyser) {
                const waveData = currentActiveAnalyser.getValue();
                let sum = 0.0;
                for(let j=0; j<waveData.length; j++) sum += Math.abs(waveData[j]);
                ampValue = sum / waveData.length;
            }
            bigWallMaterial.uniforms.uAudioLevel.value += (ampValue - bigWallMaterial.uniforms.uAudioLevel.value) * 0.1;
        }

        const inspectedArtifact = exhibits.find(ex => ex.userData.isInspected);
        updateParticles(inspectedArtifact, timeSec);

        controllers.forEach(controller => {
            if (controller.userData.isSelecting && controller.userData.grabbedObject) {
                const curMat = controller.matrixWorld; const prevMat = controller.userData.previousMatrix;
                
                const currentRot = new THREE.Quaternion().setFromRotationMatrix(curMat);
                const prevRot = new THREE.Quaternion().setFromRotationMatrix(prevMat);
                const deltaQuat = currentRot.clone().multiply(prevRot.clone().invert());
                controller.userData.grabbedObject.quaternion.premultiply(deltaQuat);
                
                const curPos = new THREE.Vector3().setFromMatrixPosition(curMat);
                const prevPos = new THREE.Vector3().setFromMatrixPosition(prevMat);
                const deltaPos = curPos.clone().sub(prevPos);
                controller.userData.grabbedObject.position.add(deltaPos);
                controller.userData.grabbedObject.userData.targetPosition.copy(controller.userData.grabbedObject.position);
                
                tossVelocity.set(deltaQuat.y * 0.15, deltaQuat.x * 0.15);
                controller.userData.grabbedObject.userData.angularVelocity.copy(tossVelocity);

                controller.userData.previousMatrix.copy(curMat);
                triggerAudioHapticSync(controller, controller.userData.grabbedObject);
            }
        });

        exhibits.forEach(artifact => {
            const isGrabbed = controllers.some(c => c.userData.grabbedObject === artifact);
            if (artifact.children[0] && artifact.children[0].userData.animate && artifact !== draggedArtifact && !isGrabbed) {
                artifact.children[0].userData.animate(artifact.userData.speedMultiplier);
            }
            
            if (artifact.userData.angularVelocity && artifact.userData.angularVelocity.lengthSq() > 0.00001) {
                artifact.rotation.y += artifact.userData.angularVelocity.x;
                artifact.rotation.x += artifact.userData.angularVelocity.y;
                artifact.userData.angularVelocity.multiplyScalar(0.95); 
            } else if (!artifact.userData.isInspected && artifact !== draggedArtifact && !isGrabbed) {
                artifact.quaternion.slerp(new THREE.Quaternion().identity(), 0.06);
            }
            
            artifact.position.lerp(artifact.userData.targetPosition, 0.06);
            if (artifact.userData.targetScale) artifact.scale.lerp(artifact.userData.targetScale, 0.06);
            if (artifact !== draggedArtifact && !isGrabbed) artifact.position.y += Math.sin(time * 0.002 + artifact.id) * 0.0004;

            if (artifact.userData.audioData && artifact.userData.parentExhibit.userData.pedestalRing) {
                const ringMat = artifact.userData.parentExhibit.userData.pedestalRing;
                const level = Tone.dbToGain(artifact.userData.audioData.meter.getValue());
                ringMat.opacity = Math.max(0.2, Math.min(1.0, level * 2.0));
            }
        });

        visualizerBars.forEach(visualizerDeck => {
            const node = audioNodes.find(n => n.exhibitId === visualizerDeck.exhibitId);
            if (node && node.fft) {
                const freqs = node.fft.getValue(); 
                visualizerDeck.bars.forEach((bar, index) => {
                    const bandIndex = Math.floor((index / visualizerDeck.bars.length) * freqs.length);
                    const db = freqs[bandIndex] || -100;
                    const scale = Math.max(0.1, Tone.dbToGain(db) * 4.0); 
                    
                    bar.scale.y += (scale - bar.scale.y) * 0.15;
                    bar.position.y = 1.02 + bar.scale.y * 0.005;
                    bar.material.opacity = Math.max(0.2, Math.min(1.0, scale * 0.5));
                });
            }
        });
        
        for (let i = wishlistMiniatures.length - 1; i >= 0; i--) {
            const mini = wishlistMiniatures[i];
            mini.progress += 0.02;
            mini.mesh.rotation.y += 0.1;
            mini.mesh.rotation.x += 0.05;
            
            let targetPos = new THREE.Vector3(0, -99, 0); // Default to offscreen
            if (renderer.xr.isPresenting && leftWristHUD) {
                leftWristHUD.getWorldPosition(targetPos);
            } else if (renderer.xr.isPresenting && mini.controllerTarget) {
                mini.controllerTarget.getWorldPosition(targetPos);
            } else {
                targetPos.set(-3, 1, 3); // Fallback corner of room
            }
            
            const easedP = 1 - Math.pow(1 - mini.progress, 3);
            mini.mesh.position.lerpVectors(mini.startPos, targetPos, easedP);
            mini.mesh.scale.lerpVectors(mini.startScale, new THREE.Vector3(0.01, 0.01, 0.01), mini.progress);
            
            if (mini.progress >= 1.0) {
                scene.remove(mini.mesh);
                
                // Add physical copy to fitting room
                if (window.fittingRoomGroup && mini.originalArtifact && mini.originalArtifact.userData.model) {
                    const clone = mini.originalArtifact.userData.model.clone();
                    
                    // Assign positions dynamically (row layout)
                    const count = window.fittingRoomItemMeshes.length;
                    const xOffset = -2.5 + (count % 4) * 1.5;
                    const zOffset = 2.0 - Math.floor(count / 4) * 1.5;
                    clone.scale.set(1.2, 1.2, 1.2);
                    clone.position.set(xOffset, 1.3, zOffset);
                    clone.rotation.y = Math.PI; // Face outwards
                    
                    // Spawn physical marble/granite pedestal below the cloned garment
                    const pedestalMat = new THREE.MeshStandardMaterial({
                        color: 0x1b1d20,
                        roughness: 0.15,
                        metalness: 0.8
                    });
                    const pedestalMesh = new THREE.Mesh(
                        new THREE.CylinderGeometry(0.5, 0.52, 0.4, 32),
                        pedestalMat
                    );
                    pedestalMesh.position.set(xOffset, 0.2, zOffset);
                    pedestalMesh.castShadow = true;
                    pedestalMesh.receiveShadow = true;
                    window.fittingRoomGroup.add(pedestalMesh);
                    
                    window.fittingRoomItemMeshes.push(clone);
                    window.fittingRoomGroup.add(clone);
                    
                    // Re-render the smart dressing mirror to list the additions
                    drawFittingRoomMirror();
                }
                
                wishlistMiniatures.splice(i, 1);
            }
        }

        interactablePanels.forEach(panel => {
            const now = Date.now();
            const d = panel.userData;
            if (d && d.staggerTime && now >= d.staggerTime) {
                if (d.transitionProgress < 1.0) {
                    d.transitionProgress += 0.02; // Smooth 50-frame transition (~0.8s)
                    if (d.transitionProgress > 1.0) d.transitionProgress = 1.0;
                    
                    const t = d.transitionProgress;
                    // Cubic ease-out
                    const easedT = 1 - Math.pow(1 - t, 3);
                    // Overshooting back ease-out for a tactile spring-loaded effect
                    const scaleT = 1 + 1.2 * Math.pow(t - 1, 3) + 0.2 * Math.pow(t - 1, 2);
                    
                    panel.scale.set(scaleT, scaleT, scaleT);
                    panel.material.opacity = easedT;
                }
            }
            drawUIPanel(panel, timeSec); 
        });

        const rayOrigins = [];
        const crosshairContainer = document.getElementById('crosshair-container');
        const crosshair = document.getElementById('crosshair');

        if (renderer.xr.isPresenting) {
            if(crosshairContainer) crosshairContainer.style.display = 'none';
            let anyTeleporting = false;
            controllers.forEach(controller => {
                const tempMatrix = new THREE.Matrix4(); tempMatrix.identity().extractRotation(controller.matrixWorld);
                const ray = new THREE.Ray(); ray.origin.setFromMatrixPosition(controller.matrixWorld);
                ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix); rayOrigins.push(ray);
                const targetObjects = [...interactablePanels];
                if (leftWristHUD) targetObjects.push(leftWristHUD);
                raycaster.ray.copy(ray); const intersects = raycaster.intersectObjects(targetObjects);
                const line = controller.getObjectByName('line');
                const tLine = controller.userData.teleportLine;
                
                if (tLine) tLine.visible = false;

                if (line) {
                    if (controller.userData.isTeleporting) {
                        line.visible = false;
                    } else {
                        line.visible = true;
                        if (intersects.length > 0) { line.scale.z = intersects[0].distance / 5; line.material.color.setHex(0xe50010); line.material.opacity = 0.8; } 
                        else { line.scale.z = 1; line.material.color.setHex(0xffffff); line.material.opacity = 0.3; }
                    }
                }

                if (controller.userData.isTeleporting) {
                    anyTeleporting = true;
                    raycaster.ray.copy(ray);
                    const floors = [];
                    scene.traverse(child => { if (child.name === 'teleportFloor') floors.push(child); });
                    if (floors.length > 0) {
                        const floorHits = raycaster.intersectObjects(floors);
                        if (floorHits.length > 0) {
                            teleportMarker.position.copy(floorHits[0].point);
                            teleportMarker.position.y += 0.02;
                            teleportMarker.visible = true;
                            controller.userData.teleportTarget = floorHits[0].point;
                            
                            if (tLine) {
                                tLine.visible = true;
                                const p0 = ray.origin;
                                const p2 = floorHits[0].point;
                                const dist = p0.distanceTo(p2);
                                const p1 = new THREE.Vector3().lerpVectors(p0, p2, 0.5);
                                p1.y += dist * 0.25; // Arc height proportional to distance
                                
                                const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
                                const points = curve.getPoints(20);
                                tLine.geometry.setFromPoints(points);
                            }
                        } else {
                            teleportMarker.visible = false;
                            controller.userData.teleportTarget = null;
                            if (line) { line.visible = true; line.scale.z = 1; line.material.color.setHex(0x00aaff); }
                        }
                    }
                }
            });
            if (!anyTeleporting && teleportMarker) teleportMarker.visible = false;
        } else {
            if (crosshairContainer && crosshair) {
                crosshairContainer.style.display = 'flex';
                const rayMouse = isPointerDown ? mouse : new THREE.Vector2(0,0);
                raycaster.setFromCamera(rayMouse, camera); rayOrigins.push(raycaster.ray);
                const isHoveringExhibit = raycaster.intersectObjects(exhibits, true).some(h => {
                    let curr = h.object;
                    while (curr && !exhibits.includes(curr)) {
                        curr = curr.parent;
                    }
                    return curr && curr.userData && curr.userData.isInspected;
                });

                if (isPointerDown) { 
                    crosshairContainer.style.left = `${(mouse.x + 1) / 2 * 100}%`; 
                    crosshairContainer.style.top = `${(-mouse.y + 1) / 2 * 100}%`; 
                } else { 
                    crosshairContainer.style.left = '50%'; 
                    crosshairContainer.style.top = '50%'; 
                }

                if (activeSlider || hoveredUIElement) { 
                    crosshair.style.transform = 'scale(2.0)'; 
                    crosshair.style.backgroundColor = 'rgba(229, 0, 16, 0.8)'; 
                } 
                else if (isHoveringExhibit) { 
                    crosshair.style.transform = 'scale(1.5)'; 
                    crosshair.style.backgroundColor = 'rgba(255, 170, 0, 0.8)'; 
                } 
                else { 
                    crosshair.style.transform = 'scale(1)'; 
                    crosshair.style.backgroundColor = 'rgba(255, 255, 255, 0.6)'; 
                }
            }
        }
        updateHoverStates(rayOrigins);
        if (renderer.xr.isPresenting) {
            if (!window.xrStateResetDone) {
                renderer.setRenderTarget(null);
                if (renderer.state && typeof renderer.state.reset === 'function') {
                    renderer.state.reset();
                }
                window.xrStateResetDone = true;
            }
            renderer.render(scene, camera);
        } else {
            window.xrStateResetDone = false;
            if (composer) {
                composer.render();
            } else {
                renderer.render(scene, camera);
            }
        }
        } catch (e) {
            console.error(e);
            if (!window.renderErrLogged) {
                window.renderErrLogged = true;
                const errDiv = document.createElement("div");
                errDiv.style.position = "absolute"; errDiv.style.top = "50px"; errDiv.style.left = "10px"; errDiv.style.color = "yellow"; errDiv.style.zIndex = "9999"; errDiv.innerText = e.stack; document.body.appendChild(errDiv);
            }
        }
    }

    function setLightingMode(mode) {
        currentLightingMode = mode;
        if (!hemiLight || !ambientLight || !dirLight || !topLight) return;
        if (mode === 'golden_hour') {
            ambientLight.color.setHex(0xffaa55); ambientLight.intensity = 0.5;
            hemiLight.color.setHex(0xffffff); hemiLight.groundColor.setHex(0xffaa55); hemiLight.intensity = 0.5;
            dirLight.color.setHex(0xffaa55); dirLight.intensity = 2.5; dirLight.position.set(20, 5, 20);
            topLight.color.setHex(0xffaa55); topLight.intensity = 0.5;
        } else if (mode === 'runway') {
            ambientLight.color.setHex(0xffffff); ambientLight.intensity = 0.2;
            hemiLight.color.setHex(0xffffff); hemiLight.groundColor.setHex(0x111111); hemiLight.intensity = 0.3;
            dirLight.color.setHex(0xffffff); dirLight.intensity = 5.0; dirLight.position.set(0, 5, 20); // Strong flash from front
            topLight.color.setHex(0xffffff); topLight.intensity = 2.0;
        } else {
            // Nordic (Default)
            ambientLight.color.setHex(0xffeedd); ambientLight.intensity = 0.6;
            hemiLight.color.setHex(0xffffff); hemiLight.groundColor.setHex(0x444444); hemiLight.intensity = 0.6;
            dirLight.color.setHex(0xfff6ee); dirLight.intensity = 1.8; dirLight.position.set(10, 18, 5);
            topLight.color.setHex(0xfff5e6); topLight.intensity = 0.8;
        }
        drawFittingRoomMirror();
    }

    function captureImage() {
        if (!renderer || !scene || !camera) return null;
        if (renderer.xr.isPresenting) {
            renderer.render(scene, camera);
        } else if (composer) {
            composer.render();
        } else {
            renderer.render(scene, camera);
        }
        return renderer.domElement.toDataURL("image/jpeg", 0.9);
    }

    return {
        start: async () => {
            await Tone.start();
            initAudioSystem();
        },
        setLightingMode,
        captureImage,
        dispose: () => {
             window.removeEventListener('resize', windowResizeListener);
             window.removeEventListener('mousedown', windowMouseDownListener);
             window.removeEventListener('mousemove', windowMouseMoveListener);
             window.removeEventListener('mouseup', windowMouseUpListener);
             window.removeEventListener('click', windowClickListener);
             
             if (renderer) {
                 renderer.setAnimationLoop(null);
                 renderer.dispose();
             }
             
             if (scene) {
                 scene.traverse((child) => {
                     if (child.geometry) child.geometry.dispose();
                     if (child.material) {
                         if (Array.isArray(child.material)) {
                             child.material.forEach(m => m.dispose());
                         } else {
                             child.material.dispose();
                         }
                     }
                 });
             }
             
             try {
                Tone.Transport.stop();
                Tone.Transport.cancel(0);
                if (mainReverb) mainReverb.dispose();
                audioNodes.forEach(n => {
                    if (n.synth) n.synth.dispose();
                    if (n.filter) n.filter.dispose();
                    if (n.panner) n.panner.dispose();
                    if (n.analyser) n.analyser.dispose();
                    if (n.fft) n.fft.dispose();
                    if (n.meter) n.meter.dispose();
                    if (n.loop) n.loop.dispose();
                });
             } catch(e) {}
             
             if (composer) composer.dispose();
        }
    };
}
