import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, PlayCircle, Loader2, Camera, Download, X, Sun, SunMoon, ShoppingBag, Activity, ScanLine } from 'lucide-react';
import { createXREngine } from './lib/engine.js';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<any>(null);
  
  const [engineState, setEngineState] = useState<'booting' | 'ready' | 'running'>('booting');
  const [lightMode, setLightMode] = useState<'nordic' | 'golden_hour' | 'runway'>('nordic');
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [wishlistItems, setWishlistItems] = useState<{ id: string, name: string, fabric?: string, price?: string }[]>([]);
  const [telemetry, setTelemetry] = useState<{ time: string, message: string }[]>([]);
  const [vrExitModal, setVrExitModal] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [checkoutComplete, setCheckoutComplete] = useState(false);

  const handleCheckout = () => {
      setIsCheckingOut(true);
      setTimeout(() => {
          setIsCheckingOut(false);
          setCheckoutComplete(true);
          setWishlistItems([]);
      }, 2500);
      
      setTimeout(() => {
          setCheckoutComplete(false);
          setWishlistOpen(false);
      }, 6000);
  };

  useEffect(() => {
    if (!containerRef.current) return;

    // Isolate creation to ensure it only happens once
    const engine = createXREngine(containerRef.current, () => {
      setEngineState((current) => current === 'booting' ? 'ready' : current);
    });
    
    engineRef.current = engine;

    const handleTelemetry = (e: any) => {
        const detail = e.detail;
        const time = new Date().toISOString().split('T')[1].slice(0, -1);
        let msg = '';
        if (detail.action === 'WISHLIST_ADD') {
            msg = `ADDED TO WISHLIST: ${detail.item}`;
            setWishlistItems(prev => prev.find(i => i.name === detail.item) ? prev : [...prev, { id: Math.random().toString(), name: detail.item, fabric: detail.fabric || 'cotton', price: detail.price || '$85' }]);
        } else if (detail.action === 'INSPECT') {
            msg = `FOCUSED: ${detail.item}`;
        } else if (detail.action === 'MATERIAL_SELECT') {
            msg = `SWAPPED FABRIC: ${detail.fabric.toUpperCase()} on ${detail.item}`;
        } else if (detail.action === 'CHECKOUT_VR_START') {
            msg = `VR SYSTEM INITIATED CHECKOUT`;
            setWishlistOpen(true);
            setTimeout(() => {
                handleCheckout();
            }, 500);
        }
        
        if (msg) {
            setTelemetry(prev => [{ time, message: msg }, ...prev].slice(0, 5));
        }
    };
    
    const handleVRExit = () => {
        setVrExitModal(true);
    };

    window.addEventListener('hm-telemetry', handleTelemetry);
    window.addEventListener('xr-session-ended', handleVRExit);

    return () => {
      engine.dispose();
      engineRef.current = null;
      window.removeEventListener('hm-telemetry', handleTelemetry);
      window.removeEventListener('xr-session-ended', handleVRExit);
    };
  }, []);

  const handleEnter = async () => {
    if (engineRef.current) {
      setEngineState('running');
      try {
        await engineRef.current.start();
      } catch (err) {
        console.error("Failed to start audio/XR context:", err);
      }
    }
  };

  const changeLighting = (mode: 'nordic' | 'golden_hour' | 'runway') => {
    setLightMode(mode);
    if (engineRef.current && engineRef.current.setLightingMode) {
        engineRef.current.setLightingMode(mode);
    }
  };

  const takeSnapshot = () => {
    if (engineRef.current && engineRef.current.captureImage) {
        const dataUrl = engineRef.current.captureImage();
        if (dataUrl) {
            setSnapshot(dataUrl);
            const burst = new Audio('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/main/2.0/Box/glTF/Box.gltf'); // wait we don't have a camera sound, let's skip the sound or use Tone later.
        }
    }
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black selection:bg-red-500/30">
      {/* 3D WebGL / XR Canvas Container */}
      <div ref={containerRef} className="absolute inset-0 z-0" />

      {/* Crosshair Overlay (Managed by XR Engine internally, but DOM needs to exist) */}
      <div
        id="crosshair-container"
        className="pointer-events-none absolute top-1/2 left-1/2 z-40 hidden h-8 w-8 -translate-x-1/2 -translate-y-1/2 transform items-center justify-center"
      >
        <div
          id="gaze-loader"
          className="absolute h-8 w-8 rounded-full border-2 border-[rgba(229,0,16,0)] border-t-[rgba(229,0,16,0.85)] opacity-0 transition-opacity duration-150"
        />
        <div
          id="crosshair"
          className="h-2 w-2 rounded-full bg-white/80 shadow-[0_0_8px_rgba(0,0,0,0.5)] transition-all duration-100 ease-out"
        />
      </div>

      {/* Running Experience Overlay */}
      <AnimatePresence>
        {engineState === 'running' && (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 pointer-events-none z-30"
            >
                {/* Telemetry HUD */}
                <div className="absolute top-8 right-8 w-80 font-mono flex flex-col gap-2 p-4">
                    <div className="flex items-center gap-2 text-red-500 font-semibold text-xs tracking-widest mb-2 shadow-[0_0_10px_rgba(229,0,16,0.3)] bg-black/40 p-2 rounded backdrop-blur">
                        <Activity className="w-4 h-4 animate-pulse" /> SYSTEM TELEMETRY
                    </div>
                    {telemetry.map((log, i) => (
                        <motion.div 
                            key={i} 
                            initial={{ opacity: 0, x: 20 }} 
                            animate={{ opacity: 1 - i*0.2, x: 0 }} 
                            className="text-[10px] text-zinc-300 bg-black/60 backdrop-blur border border-white/5 p-2 rounded flex flex-col"
                        >
                            <span className="text-zinc-500 mb-1">{log.time}</span>
                            <span className="leading-tight">{log.message}</span>
                        </motion.div>
                    ))}
                </div>

                {/* Bottom Navigation */}
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-4 pointer-events-auto items-center p-3 rounded-full bg-zinc-950/80 backdrop-blur-xl border border-white/10 shadow-2xl">
                    <button onClick={() => changeLighting('nordic')} className={`p-4 rounded-full transition-all ${lightMode === 'nordic' ? 'bg-red-500 text-white' : 'hover:bg-white/10 text-white/50'}`} title="Nordic Minimalist">
                        <Sun className="w-5 h-5" />
                    </button>
                    <button onClick={() => changeLighting('golden_hour')} className={`p-4 rounded-full transition-all ${lightMode === 'golden_hour' ? 'bg-red-500 text-white' : 'hover:bg-white/10 text-white/50'}`} title="Golden Hour">
                        <SunMoon className="w-5 h-5" />
                    </button>
                    <button onClick={() => changeLighting('runway')} className={`p-4 rounded-full transition-all ${lightMode === 'runway' ? 'bg-red-500 text-white' : 'hover:bg-white/10 text-white/50'}`} title="Runway Studio">
                        <Camera className="w-5 h-5" />
                    </button>
                    <div className="w-px h-8 bg-white/20 mx-2" />
                    <button onClick={takeSnapshot} className="p-4 rounded-full bg-white text-black hover:bg-neutral-200 transition-colors shadow-[0_0_20px_rgba(255,255,255,0.4)]" title="Capture Snapshot">
                        <Camera className="w-5 h-5" />
                    </button>
                    <div className="w-px h-8 bg-white/20 mx-2" />
                    <button onClick={() => setWishlistOpen(true)} className="flex items-center gap-2 p-4 px-6 rounded-full bg-red-600 text-white hover:bg-red-700 transition font-mono tracking-widest text-xs" title="Wishlist / Checkout">
                        <ShoppingBag className="w-5 h-5" />
                        <span>FITTING ROOM ({wishlistItems.length})</span>
                    </button>
                </div>
            </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {wishlistOpen && (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
            >
                <div className="absolute inset-0 cursor-pointer" onClick={() => setWishlistOpen(false)} />
                <motion.div
                    initial={{ x: "100%" }}
                    animate={{ x: 0 }}
                    exit={{ x: "100%" }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    className="relative w-full max-w-xl h-full bg-[#f8f8f8]/95 backdrop-blur-xl p-8 md:p-12 shadow-2xl flex flex-col gap-6 overflow-y-auto"
                >
                    <button onClick={() => setWishlistOpen(false)} className="absolute top-6 right-6 p-2 text-neutral-400 hover:text-black">
                        <X className="w-8 h-8" />
                    </button>
                    
                    <div>
                        <h2 className="text-3xl font-light tracking-[0.2em] uppercase text-black mb-1">Fitting Room</h2>
                        <p className="text-sm font-mono tracking-widest text-neutral-400">YOUR SELECTED GARMENTS</p>
                    </div>
                        
                    {wishlistItems.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center py-12 text-center text-neutral-400 font-mono text-sm border-2 border-dashed border-neutral-300">
                            NO ITEMS SELECTED
                        </div>
                    ) : (
                        <ul className="flex-1 space-y-4 overflow-y-auto pr-2">
                            {wishlistItems.map((item) => (
                                <li key={item.id} className="flex items-center justify-between p-4 bg-white shadow-sm border border-neutral-100">
                                    <div className="flex flex-col gap-1">
                                        <span className="font-semibold text-lg">{item.name}</span>
                                        <span className="text-xs font-mono text-neutral-500 uppercase">
                                            {item.fabric} Edition • {item.price}
                                        </span>
                                    </div>
                                    <button onClick={() => setWishlistItems(prev => prev.filter(i => i.id !== item.id))} className="text-red-500 hover:text-red-700 text-xs font-mono underline ml-4">
                                        REMOVE
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    
                    {wishlistItems.length > 0 && (
                        <div className="bg-white border border-neutral-200 p-8 flex flex-col items-center text-center mt-4 shrink-0">
                            <h3 className="font-bold text-xl uppercase mb-2">Order Summary</h3>
                            <div className="w-full flex justify-between font-mono text-sm text-neutral-600 mb-6">
                                <span>TOTAL</span>
                                <span className="font-bold text-black">${wishlistItems.reduce((acc, curr) => acc + parseInt((curr.price || '$0').replace('$', '')), 0)}</span>
                            </div>
                            
                            <p className="text-xs text-neutral-500 mb-6 font-mono">Select Proceed to Checkout to confirm sizing and finalize your physical order.</p>
                            
                            <button onClick={handleCheckout} className="w-full py-4 bg-black text-white font-mono tracking-widest text-sm hover:bg-neutral-800 transition shadow-xl">
                                PROCEED TO CHECKOUT
                            </button>
                        </div>
                    )}
                </motion.div>
                
                {/* Checkout Experience Overlays */}
                <AnimatePresence>
                    {isCheckingOut && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 z-[60] bg-zinc-950 flex flex-col items-center justify-center text-white"
                        >
                            <Loader2 className="w-12 h-12 text-white animate-spin mb-8" />
                            <h2 className="text-2xl font-light tracking-[0.2em] uppercase">Processing Secure Checkout</h2>
                            <p className="text-sm font-mono tracking-widest text-neutral-400 mt-4">APPLE PAY • AUTHENTICATING</p>
                        </motion.div>
                    )}
                </AnimatePresence>
                
                <AnimatePresence>
                    {checkoutComplete && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="absolute inset-0 z-[60] bg-white flex flex-col items-center justify-center text-black"
                        >
                            <Activity className="w-16 h-16 text-black mb-8" />
                            <h2 className="text-4xl font-light tracking-[0.2em] uppercase">Order Confirmed</h2>
                            <p className="text-sm font-mono tracking-widest text-neutral-500 mt-4 text-center max-w-sm">
                                YOUR PHYSICAL GARMENTS WILL BE SHIPPED. YOUR DIGITAL TWINS HAVE BEEN ADDED TO YOUR VAULT.
                            </p>
                        </motion.div>
                    )}
                </AnimatePresence>
                
            </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {snapshot && (
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md p-12"
            >
                <div className="relative max-w-4xl w-full bg-[#f8f8f8] p-8 md:p-12 shadow-2xl rounded-sm flex flex-col items-center">
                    <button onClick={() => setSnapshot(null)} className="absolute top-6 right-6 p-2 text-neutral-400 hover:text-black">
                        <X className="w-8 h-8" />
                    </button>
                    
                    <h2 className="text-3xl font-light tracking-[0.2em] uppercase text-black mb-1 p-4">H&M Lookbook</h2>
                    <p className="text-sm font-mono tracking-widest text-neutral-400 mb-8">VIRTUAL CAPSULE COLLECTION</p>
                    
                    <div className="w-full aspect-video bg-neutral-200 overflow-hidden shadow-inner flex items-center justify-center p-4">
                        <img src={snapshot} alt="Lookbook Snapshot" className="w-full h-full object-contain drop-shadow-xl" />
                    </div>
                    
                    <div className="mt-8 flex gap-4 w-full justify-center">
                        <a href={snapshot} download="hm_lookbook_snap.jpg" className="flex items-center gap-2 px-8 py-4 bg-red-600 text-white hover:bg-red-700 transition font-mono tracking-widest text-xs">
                            <Download className="w-4 h-4" /> SAVE TO LOOKBOOK
                        </a>
                        <button onClick={() => setSnapshot(null)} className="flex items-center gap-2 px-8 py-4 bg-black text-white hover:bg-neutral-800 transition font-mono tracking-widest text-xs">
                            RETURN TO GALLERY
                        </button>
                    </div>
                </div>
            </motion.div>
        )}
      </AnimatePresence>

      {/* Landing Experience Overlay */}
      <AnimatePresence>
        {engineState !== 'running' && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, filter: 'blur(10px)', scale: 1.05 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-zinc-950/90 backdrop-blur-md"
          >
            {/* Ambient background glows */}
            <div className="absolute top-1/4 left-1/4 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 scale-150 rounded-full bg-red-600/15 blur-[120px]" />
            <div className="absolute bottom-1/4 right-1/4 h-[400px] w-[400px] translate-x-1/2 translate-y-1/2 scale-150 rounded-full bg-orange-600/10 blur-[100px]" />
            
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.8 }}
              className="relative flex max-w-2xl flex-col items-center justify-center p-8 text-center"
            >
              <div className="mb-6 flex h-24 w-24 items-center justify-center rounded-full border border-red-500/20 bg-red-500/5 shadow-[0_0_40px_rgba(229,0,16,0.15)]">
                {engineState === 'booting' ? (
                  <Loader2 className="h-8 w-8 animate-spin text-red-500" />
                ) : (
                  <PlayCircle className="h-10 w-10 text-red-500" />
                )}
              </div>
              
              <h1 className="font-display mb-4 text-4xl font-light tracking-[0.2em] text-white sm:text-5xl lg:text-5xl text-transparent bg-clip-text bg-gradient-to-b from-white to-white/60 uppercase">
                H&M Virtual Showroom
              </h1>
              
              <div className="mb-8 flex flex-col items-center gap-2">
                <span className="font-mono text-xs font-semibold tracking-[0.3em] text-red-500">
                  {engineState === 'booting' ? 'PREPARING COLLECTION' : 'SHOWROOM READY'}
                </span>
                <div className="h-px w-24 bg-gradient-to-r from-transparent via-red-500/40 to-transparent" />
              </div>
              
              <p className="font-sans mb-12 max-w-lg leading-relaxed text-zinc-400">
                Explore the new H&M digital collection in an immersive parametric gallery. 
                Discover intricate 3D garments, interact with sustainable fabrics, and step into the future of fashion.
              </p>

              <motion.button
                whileHover={{ scale: 1.05, backgroundColor: 'rgba(229, 0, 16, 0.15)' }}
                whileTap={{ scale: 0.95 }}
                onClick={handleEnter}
                disabled={engineState === 'booting'}
                className="group relative overflow-hidden rounded border border-red-500/50 bg-red-500/10 px-8 py-4 px-12 font-mono text-sm font-semibold tracking-widest text-red-500 uppercase transition-all hover:border-red-500 hover:text-white hover:shadow-[0_0_30px_rgba(229,0,16,0.3)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
                Enter Showroom
              </motion.button>
            </motion.div>

            {/* Tech metadata footer */}
            <div className="absolute bottom-8 font-mono text-[10px] tracking-widest text-zinc-600">
              <p>WEBXR // THREE.JS // H&M DIGITAL SHOWROOM</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {vrExitModal && (
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-xl p-12"
            >
                <div className="relative max-w-2xl w-full text-center">
                    <h2 className="text-4xl font-light tracking-[0.2em] uppercase text-white mb-6 p-4">VR Session Concluded</h2>
                    <p className="text-sm font-mono tracking-widest text-neutral-400 mb-12">THANK YOU FOR VISITING THE VIRTUAL COLLECTION. YOU CAN CONTINUE BROWSING ON DESKTOP.</p>
                    <button onClick={() => setVrExitModal(false)} className="px-12 py-5 bg-red-600 text-white hover:bg-red-700 transition font-mono tracking-widest text-sm shadow-[0_0_20px_rgba(229,0,16,0.3)]">
                        RESUME DESKTOP MODE
                    </button>
                </div>
            </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
