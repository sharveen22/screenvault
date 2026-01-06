import { useState, useEffect, useRef } from 'react';
import { Copy, Share2, Pen, Type, Square, ArrowRight, Undo, Redo, Trash2, Crop, Check, X, MousePointer2, Save, AlertTriangle } from 'lucide-react';

// --- Types ---
type Tool = 'select' | 'pen' | 'text' | 'rect' | 'arrow' | 'crop' | null;
type Annotation =
    | { id: string; type: 'pen'; points: { x: number, y: number }[]; color: string; size: number }
    | { id: string; type: 'rect'; x: number; y: number; w: number; h: number; color: string; size: number }
    | { id: string; type: 'arrow'; from: { x: number, y: number }; to: { x: number, y: number }; color: string; size: number }
    | { id: string; type: 'text'; x: number; y: number; text: string; color: string; size: number };

const COLORS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#ffffff', '#000000'];

// History State Interface
interface HistoryState {
    annotations: Annotation[];
    imageSrc: string; // Data URL of the background image
}

export function Editor() {
    // --- State ---
    const [filePath, setFilePath] = useState<string>('');
    const [imageBitmap, setImageBitmap] = useState<HTMLImageElement | null>(null);
    const [annotations, setAnnotations] = useState<Annotation[]>([]);

    // History now tracks the entire state (image + annotations)
    const [history, setHistory] = useState<HistoryState[]>([]);
    const [historyStep, setHistoryStep] = useState(-1);

    const [activeTool, setActiveTool] = useState<Tool>('select');
    const [selectedId, setSelectedId] = useState<string | null>(null);

    const [currentColor, setCurrentColor] = useState(COLORS[0]);
    const [currentSize, setCurrentSize] = useState(4); // Default size

    // Interaction State
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState<{ x: number, y: number } | null>(null);
    const [currentAnnotation, setCurrentAnnotation] = useState<Annotation | null>(null);

    // Text Input State
    const [textInput, setTextInput] = useState<{ id?: string, x: number, y: number, text: string } | null>(null);

    // Crop State
    const [cropRect, setCropRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null);

    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // --- Init ---
    useEffect(() => {
        const removeListener = window.electronAPI.onInit((path) => {
            setFilePath(path);
            window.electronAPI.file.read(path).then(({ data }) => {
                if (data) {
                    const src = `data:image/png;base64,${data}`;
                    const img = new Image();
                    img.onload = () => {
                        setImageBitmap(img);
                        setCropRect({ x: 0, y: 0, w: img.width, h: img.height });

                        // Initialize History
                        const initialState: HistoryState = { annotations: [], imageSrc: src };
                        setHistory([initialState]);
                        setHistoryStep(0);
                    };
                    img.src = src;
                }
            });
        });

        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'c') handleCopy();
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                if (e.shiftKey) handleRedo();
                else handleUndo();
            }
            if (e.key === 'Escape') handleEscape();
            if (e.key === 'Backspace' || e.key === 'Delete') handleDelete();
            if (e.key === 'Enter' && activeTool === 'crop') applyCrop();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            removeListener();
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeTool, annotations, selectedId, cropRect]);

    // --- History Management ---
    const pushHistory = (newAnnotations: Annotation[], newImageSrc?: string) => {
        // If newImageSrc is provided, it means the background changed (Crop)
        // Otherwise use current image src from history or current state
        const currentSrc = newImageSrc || (history[historyStep]?.imageSrc);

        const newState: HistoryState = {
            annotations: newAnnotations,
            imageSrc: currentSrc
        };

        const newHistory = history.slice(0, historyStep + 1);
        newHistory.push(newState);
        setHistory(newHistory);
        setHistoryStep(newHistory.length - 1);

        setAnnotations(newAnnotations);
        if (newImageSrc) {
            const img = new Image();
            img.onload = () => setImageBitmap(img);
            img.src = newImageSrc;
        }
    };

    const handleUndo = () => {
        if (historyStep > 0) {
            const newStep = historyStep - 1;
            setHistoryStep(newStep);
            restoreState(history[newStep]);
        }
    };

    const handleRedo = () => {
        if (historyStep < history.length - 1) {
            const newStep = historyStep + 1;
            setHistoryStep(newStep);
            restoreState(history[newStep]);
        }
    };

    const restoreState = (state: HistoryState) => {
        setAnnotations(state.annotations);
        // Only reload image if it's different (optimization)
        if (!imageBitmap || imageBitmap.src !== state.imageSrc) {
            const img = new Image();
            img.onload = () => {
                setImageBitmap(img);
                setCropRect({ x: 0, y: 0, w: img.width, h: img.height }); // Reset crop rect to full image
            };
            img.src = state.imageSrc;
        }
    };

    // --- Rendering ---
    useEffect(() => {
        // Use requestAnimationFrame for smoother 60fps rendering
        const frameId = requestAnimationFrame(() => {
            renderCanvas();
        });
        
        return () => cancelAnimationFrame(frameId);
    }, [imageBitmap, annotations, currentAnnotation, selectedId, activeTool]);

    const renderCanvas = () => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!canvas || !ctx || !imageBitmap) return;

        if (canvas.width !== imageBitmap.width) canvas.width = imageBitmap.width;
        if (canvas.height !== imageBitmap.height) canvas.height = imageBitmap.height;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw Background
        ctx.drawImage(imageBitmap, 0, 0);

        // Draw Annotations
        const allAnnotations = [...annotations];
        if (currentAnnotation) allAnnotations.push(currentAnnotation);

        allAnnotations.forEach(ann => {
            ctx.beginPath();
            ctx.strokeStyle = ann.color;
            ctx.lineWidth = ann.size;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.fillStyle = ann.color;

            // Highlight selection
            if (ann.id === selectedId) {
                ctx.shadowColor = 'white';
                ctx.shadowBlur = 10;
                ctx.globalAlpha = 0.8;
            } else {
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.globalAlpha = 1.0;
            }

            if (ann.type === 'pen') {
                if (ann.points.length > 0) {
                    ctx.moveTo(ann.points[0].x, ann.points[0].y);
                    ann.points.forEach(p => ctx.lineTo(p.x, p.y));
                    ctx.stroke();
                }
            } else if (ann.type === 'rect') {
                ctx.strokeRect(ann.x, ann.y, ann.w, ann.h);
            } else if (ann.type === 'arrow') {
                drawArrow(ctx, ann.from.x, ann.from.y, ann.to.x, ann.to.y, ann.size);
            } else if (ann.type === 'text') {
                ctx.font = `bold ${ann.size * 4}px sans-serif`;
                ctx.fillText(ann.text, ann.x, ann.y);
            }
            ctx.globalAlpha = 1.0;
        });
    };

    const drawArrow = (ctx: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, size: number) => {
        const headlen = size * 4;
        const dx = toX - fromX;
        const dy = toY - fromY;
        const angle = Math.atan2(dy, dx);
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        // Arrowhead
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - headlen * Math.cos(angle - Math.PI / 6), toY - headlen * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(toX - headlen * Math.cos(angle + Math.PI / 6), toY - headlen * Math.sin(angle + Math.PI / 6));
        ctx.fill();
    };

    // --- Interaction Logic ---
    const getPos = (e: React.MouseEvent) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const rect = canvas.getBoundingClientRect();

        // The canvas might be CSS-scaled to fit the window
        // We need to convert from display coordinates to canvas pixel coordinates
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;

        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    const distanceToSegment = (p: { x: number, y: number }, v: { x: number, y: number }, w: { x: number, y: number }) => {
        const l2 = (v.x - w.x) ** 2 + (v.y - w.y) ** 2;
        if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
        let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
    };

    const hitTest = (pos: { x: number, y: number }, ann: Annotation) => {
        const tolerance = 15;
        if (ann.type === 'rect') {
            const x = Math.min(ann.x, ann.x + ann.w);
            const y = Math.min(ann.y, ann.y + ann.h);
            const w = Math.abs(ann.w);
            const h = Math.abs(ann.h);
            return pos.x >= x - tolerance && pos.x <= x + w + tolerance && pos.y >= y - tolerance && pos.y <= y + h + tolerance;
        }
        if (ann.type === 'text') {
            const h = ann.size * 4;
            const w = ann.text.length * (ann.size * 3);
            return pos.x >= ann.x && pos.x <= ann.x + w && pos.y >= ann.y - h && pos.y <= ann.y + 10;
        }
        if (ann.type === 'arrow') {
            return distanceToSegment(pos, ann.from, ann.to) < tolerance;
        }
        if (ann.type === 'pen') {
            for (let i = 0; i < ann.points.length - 1; i++) {
                if (distanceToSegment(pos, ann.points[i], ann.points[i + 1]) < tolerance) return true;
            }
            return false;
        }
        return false;
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        const pos = getPos(e);
        setDragStart(pos);
        setIsDragging(true);

        if (activeTool === 'select') {
            let foundId = null;
            for (let i = annotations.length - 1; i >= 0; i--) {
                if (hitTest(pos, annotations[i])) {
                    foundId = annotations[i].id;
                    break;
                }
            }
            setSelectedId(foundId);

            if (foundId) {
                const ann = annotations.find(a => a.id === foundId);
                if (ann) {
                    setCurrentColor(ann.color);
                    setCurrentSize(ann.size);
                }
            }
        } else if (activeTool === 'pen') {
            setCurrentAnnotation({
                id: crypto.randomUUID(),
                type: 'pen',
                points: [pos],
                color: currentColor,
                size: currentSize
            });
        } else if (activeTool === 'rect') {
            setCurrentAnnotation({
                id: crypto.randomUUID(),
                type: 'rect',
                x: pos.x, y: pos.y, w: 0, h: 0,
                color: currentColor,
                size: currentSize
            });
        } else if (activeTool === 'arrow') {
            setCurrentAnnotation({
                id: crypto.randomUUID(),
                type: 'arrow',
                from: pos, to: pos,
                color: currentColor,
                size: currentSize
            });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging || !dragStart) return;
        const pos = getPos(e);

        if (activeTool === 'select' && selectedId) {
            const dx = pos.x - dragStart.x;
            const dy = pos.y - dragStart.y;

            setAnnotations(prev => prev.map(ann => {
                if (ann.id !== selectedId) return ann;
                if (ann.type === 'rect' || ann.type === 'text') {
                    return { ...ann, x: ann.x + dx, y: ann.y + dy };
                }
                if (ann.type === 'arrow') {
                    return { ...ann, from: { x: ann.from.x + dx, y: ann.from.y + dy }, to: { x: ann.to.x + dx, y: ann.to.y + dy } };
                }
                if (ann.type === 'pen') {
                    return { ...ann, points: ann.points.map(p => ({ x: p.x + dx, y: p.y + dy })) };
                }
                return ann;
            }));
            setDragStart(pos);
        } else if (activeTool === 'pen' && currentAnnotation?.type === 'pen') {
            setCurrentAnnotation({
                ...currentAnnotation,
                points: [...currentAnnotation.points, pos]
            });
        } else if (activeTool === 'rect' && currentAnnotation?.type === 'rect') {
            setCurrentAnnotation({
                ...currentAnnotation,
                w: pos.x - currentAnnotation.x,
                h: pos.y - currentAnnotation.y
            });
        } else if (activeTool === 'arrow' && currentAnnotation?.type === 'arrow') {
            setCurrentAnnotation({
                ...currentAnnotation,
                to: pos
            });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
        if (currentAnnotation) {
            pushHistory([...annotations, currentAnnotation]);
            setCurrentAnnotation(null);
        }
    };

    const handleCanvasClick = (e: React.MouseEvent) => {
        if (activeTool === 'text' && !isDragging) {
            const pos = getPos(e);
            const rect = canvasRef.current!.getBoundingClientRect();
            const screenX = e.clientX - rect.left;
            const screenY = e.clientY - rect.top;
            setTextInput({ x: screenX, y: screenY, text: '' });
        }
    };

    // --- Text Input ---
    const applyText = () => {
        if (textInput && textInput.text.trim()) {
            const canvas = canvasRef.current!;
            const rect = canvas.getBoundingClientRect();
            const scaleX = canvas.width / rect.width;
            const scaleY = canvas.height / rect.height;

            const newAnn: Annotation = {
                id: crypto.randomUUID(),
                type: 'text',
                x: textInput.x * scaleX,
                y: (textInput.y * scaleY) + (currentSize * 4),
                text: textInput.text,
                color: currentColor,
                size: currentSize
            };
            pushHistory([...annotations, newAnn]);
        }
        setTextInput(null);
    };

    // --- Crop Logic ---
    const applyCrop = () => {
        if (!cropRect || !imageBitmap || !canvasRef.current) return;

        const canvas = document.createElement('canvas');
        canvas.width = cropRect.w;
        canvas.height = cropRect.h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(imageBitmap, -cropRect.x, -cropRect.y);

            // Shift annotations
            const shiftedAnnotations = annotations.map(ann => {
                if (ann.type === 'rect' || ann.type === 'text') return { ...ann, x: ann.x - cropRect.x, y: ann.y - cropRect.y };
                if (ann.type === 'pen') return { ...ann, points: ann.points.map(p => ({ x: p.x - cropRect.x, y: p.y - cropRect.y })) };
                if (ann.type === 'arrow') return { ...ann, from: { x: ann.from.x - cropRect.x, y: ann.from.y - cropRect.y }, to: { x: ann.to.x - cropRect.x, y: ann.to.y - cropRect.y } };
                return ann;
            });

            const newSrc = canvas.toDataURL();
            // Push new state with NEW image and SHIFTED annotations
            pushHistory(shiftedAnnotations, newSrc);

            setActiveTool('select');
        }
    };

    // --- Actions ---
    const handleCopy = () => {
        if (canvasRef.current) {
            window.electronAPI.copyData(canvasRef.current.toDataURL());
        }
    };

    const handleSave = () => {
        const canvas = canvasRef.current;
        if (!canvas) {
            console.error('[Editor] Cannot save: canvas ref is null');
            return;
        }

        console.log('[Editor] Saving screenshot...');
        console.log('[Editor] Canvas dimensions:', canvas.width, 'x', canvas.height);
        console.log('[Editor] Annotations count:', annotations.length);

        try {
            const dataUrl = canvas.toDataURL('image/png');
            console.log('[Editor] Data URL length:', dataUrl.length);
            console.log('[Editor] Data URL preview:', dataUrl.substring(0, 100));

            window.electronAPI.save(dataUrl);
            console.log('[Editor] Save IPC sent');
        } catch (e) {
            console.error('[Editor] Error generating/sending data URL:', e);
        }
    };

    const handleShare = () => {
        if (canvasRef.current) {
            window.electronAPI.share(canvasRef.current.toDataURL());
        }
    };

    const handleDone = () => {
        handleSave();
        window.electronAPI.close();
    };

    const handleEscape = () => {
        if (annotations.length > 0) {
            if (confirm('Discard changes and close?')) {
                window.electronAPI.close();
            }
        } else {
            window.electronAPI.close();
        }
    };

    const handleDelete = () => {
        if (selectedId) {
            const newAnns = annotations.filter(a => a.id !== selectedId);
            pushHistory(newAnns);
            setSelectedId(null);
        }
    };

    const updateSelectedProperty = (key: 'color' | 'size', value: any) => {
        if (key === 'color') setCurrentColor(value);
        if (key === 'size') setCurrentSize(value);

        if (selectedId) {
            const newAnns = annotations.map(ann =>
                ann.id === selectedId ? { ...ann, [key]: value } : ann
            );
            pushHistory(newAnns);
        }
    };

    if (!imageBitmap) return <div className="h-screen w-screen bg-[#1e1e1e] flex items-center justify-center text-white">Loading...</div>;

    return (
        <div className="h-screen w-screen bg-[#1e1e1e] flex flex-col text-white overflow-hidden">
            {/* Window Drag Handle */}
            <div className="h-3 bg-[#252525] w-full shrink-0" style={{ WebkitAppRegion: 'drag' } as any} />

            {/* Toolbar */}
            <div className="h-14 bg-[#252525] flex items-center justify-between px-4 border-b border-[#333] select-none shadow-md" style={{ WebkitAppRegion: 'drag' } as any}>
                <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as any}>
                    {/* Tools */}
                    <div className="flex items-center gap-1 bg-[#333] rounded-lg p-1">
                        <ToolButton icon={<MousePointer2 size={18} />} active={activeTool === 'select'} onClick={() => setActiveTool('select')} title="Select" />
                        <ToolButton icon={<Pen size={18} />} active={activeTool === 'pen'} onClick={() => setActiveTool('pen')} title="Pen" />
                        <ToolButton icon={<Type size={18} />} active={activeTool === 'text'} onClick={() => setActiveTool('text')} title="Text" />
                        <ToolButton icon={<Square size={18} />} active={activeTool === 'rect'} onClick={() => setActiveTool('rect')} title="Rectangle" />
                        <ToolButton icon={<ArrowRight size={18} />} active={activeTool === 'arrow'} onClick={() => setActiveTool('arrow')} title="Arrow" />
                        <div className="w-px h-6 bg-[#444] mx-1" />
                        <ToolButton icon={<Crop size={18} />} active={activeTool === 'crop'} onClick={() => setActiveTool('crop')} title="Crop" />
                    </div>

                    {/* History */}
                    <div className="flex items-center gap-1">
                        <IconButton icon={<Undo size={18} />} onClick={handleUndo} disabled={historyStep <= 0} title="Undo" />
                        <IconButton icon={<Redo size={18} />} onClick={handleRedo} disabled={historyStep >= history.length - 1} title="Redo" />
                    </div>

                    {/* Properties */}
                    <div className="flex items-center gap-3 px-3 border-l border-[#444]">
                        <div className="flex gap-1">
                            {COLORS.map(c => (
                                <button
                                    key={c}
                                    onClick={() => updateSelectedProperty('color', c)}
                                    className={`w-5 h-5 rounded-full border border-gray-600 ${currentColor === c ? 'ring-2 ring-white' : ''}`}
                                    style={{ background: c }}
                                />
                            ))}
                        </div>
                        <div className="flex items-center gap-2 ml-2">
                            <span className="text-xs text-gray-400">Size</span>
                            <input
                                type="range"
                                min="1"
                                max="20"
                                value={currentSize}
                                onChange={(e) => updateSelectedProperty('size', parseInt(e.target.value))}
                                className="w-20 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                            />
                            <span className="text-xs text-gray-400 w-4">{currentSize}</span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as any}>
                    {activeTool === 'crop' && (
                        <div className="flex items-center gap-2 mr-4">
                            <button onClick={applyCrop} className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm font-medium">
                                <Check size={14} /> Apply
                            </button>
                        </div>
                    )}

                    <IconButton icon={<Trash2 size={18} />} onClick={() => window.electronAPI.trash()} className="hover:bg-red-900/30 text-red-400" title="Delete File" />
                    <div className="w-px h-6 bg-[#333]" />
                    <IconButton icon={<Copy size={18} />} onClick={handleCopy} title="Copy" />
                    <IconButton icon={<Share2 size={18} />} onClick={handleShare} title="Share" />
                    <button onClick={handleDone} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 rounded-md text-sm font-medium transition-colors shadow-sm ml-2">
                        Done
                    </button>
                </div>
            </div>

            {/* Canvas Container */}
            <div
                ref={containerRef}
                className="flex-1 flex items-center justify-center p-8 bg-[#1e1e1e] relative overflow-hidden"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onClick={handleCanvasClick}
            >
                <div className="relative shadow-2xl" style={{ maxWidth: '100%', maxHeight: '100%', display: 'flex' }}>
                    <canvas
                        ref={canvasRef}
                        className="block rounded-sm bg-transparent"
                        style={{
                            maxWidth: '100%',
                            maxHeight: '100%',
                            objectFit: 'contain'
                        }}
                    />

                    {/* Text Input Overlay */}
                    {textInput && (
                        <input
                            autoFocus
                            value={textInput.text}
                            onChange={(e) => setTextInput({ ...textInput, text: e.target.value })}
                            onBlur={applyText}
                            onKeyDown={(e) => e.key === 'Enter' && applyText()}
                            style={{
                                position: 'absolute',
                                left: textInput.x,
                                top: textInput.y,
                                font: `bold ${currentSize * 4}px sans-serif`,
                                color: currentColor,
                                background: 'transparent',
                                border: '1px dashed rgba(255,255,255,0.5)',
                                outline: 'none',
                                padding: 0,
                                margin: 0
                            }}
                        />
                    )}

                    {/* Crop Overlay */}
                    {activeTool === 'crop' && cropRect && (
                        <CropOverlay
                            rect={cropRect}
                            onChange={setCropRect}
                            containerWidth={canvasRef.current?.width || 0}
                            containerHeight={canvasRef.current?.height || 0}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

// --- Helper Components ---

function CropOverlay({ rect, onChange, containerWidth, containerHeight }: any) {
    const [dragHandle, setDragHandle] = useState<string | null>(null);
    const [startPos, setStartPos] = useState<{ x: number, y: number } | null>(null);
    const [startRect, setStartRect] = useState<{ x: number, y: number, w: number, h: number } | null>(null);

    useEffect(() => {
        const handleGlobalMove = (e: MouseEvent) => {
            if (!dragHandle || !startPos || !startRect) return;

            const dx = e.clientX - startPos.x;
            const dy = e.clientY - startPos.y;

            let newRect = { ...startRect };

            if (dragHandle === 'move') {
                newRect.x += dx;
                newRect.y += dy;
            } else {
                if (dragHandle.includes('w')) {
                    newRect.x += dx;
                    newRect.w -= dx;
                }
                if (dragHandle.includes('e')) {
                    newRect.w += dx;
                }
                if (dragHandle.includes('n')) {
                    newRect.y += dy;
                    newRect.h -= dy;
                }
                if (dragHandle.includes('s')) {
                    newRect.h += dy;
                }
            }

            if (newRect.w < 10) newRect.w = 10;
            if (newRect.h < 10) newRect.h = 10;

            onChange(newRect);
        };

        const handleGlobalUp = () => {
            setDragHandle(null);
        };

        if (dragHandle) {
            window.addEventListener('mousemove', handleGlobalMove);
            window.addEventListener('mouseup', handleGlobalUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleGlobalMove);
            window.removeEventListener('mouseup', handleGlobalUp);
        };
    }, [dragHandle, startPos, startRect, onChange]);

    const startDrag = (e: React.MouseEvent, handle: string) => {
        e.stopPropagation();
        setDragHandle(handle);
        setStartPos({ x: e.clientX, y: e.clientY });
        setStartRect(rect);
    };

    return (
        <div className="absolute inset-0 pointer-events-none">
            <div
                style={{
                    position: 'absolute',
                    left: 0, top: 0, width: '100%', height: '100%',
                    background: 'rgba(0,0,0,0.5)',
                    clipPath: `polygon(0% 0%, 0% 100%, ${rect.x}px 100%, ${rect.x}px ${rect.y}px, ${rect.x + rect.w}px ${rect.y}px, ${rect.x + rect.w}px ${rect.y + rect.h}px, ${rect.x}px ${rect.y + rect.h}px, ${rect.x}px 100%, 100% 100%, 100% 0%)`
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    left: rect.x, top: rect.y, width: rect.w, height: rect.h,
                    border: '2px solid white',
                    boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
                    pointerEvents: 'auto',
                    cursor: 'move'
                }}
                onMouseDown={(e) => startDrag(e, 'move')}
            >
                {/* Handles */}
                <div className="absolute top-0 left-0 w-4 h-4 bg-white border border-black -translate-x-2 -translate-y-2 cursor-nw-resize" onMouseDown={(e) => startDrag(e, 'nw')} />
                <div className="absolute top-0 right-0 w-4 h-4 bg-white border border-black translate-x-2 -translate-y-2 cursor-ne-resize" onMouseDown={(e) => startDrag(e, 'ne')} />
                <div className="absolute bottom-0 left-0 w-4 h-4 bg-white border border-black -translate-x-2 translate-y-2 cursor-sw-resize" onMouseDown={(e) => startDrag(e, 'sw')} />
                <div className="absolute bottom-0 right-0 w-4 h-4 bg-white border border-black translate-x-2 translate-y-2 cursor-se-resize" onMouseDown={(e) => startDrag(e, 'se')} />

                {/* Side Handles */}
                <div className="absolute top-0 left-1/2 w-4 h-4 bg-white border border-black -translate-x-2 -translate-y-2 cursor-n-resize" onMouseDown={(e) => startDrag(e, 'n')} />
                <div className="absolute bottom-0 left-1/2 w-4 h-4 bg-white border border-black -translate-x-2 translate-y-2 cursor-s-resize" onMouseDown={(e) => startDrag(e, 's')} />
                <div className="absolute top-1/2 left-0 w-4 h-4 bg-white border border-black -translate-x-2 -translate-y-2 cursor-w-resize" onMouseDown={(e) => startDrag(e, 'w')} />
                <div className="absolute top-1/2 right-0 w-4 h-4 bg-white border border-black translate-x-2 -translate-y-2 cursor-e-resize" onMouseDown={(e) => startDrag(e, 'e')} />
            </div>
        </div>
    );
}

function ToolButton({ icon, active, onClick, title }: any) {
    return (
        <button
            onClick={onClick}
            className={`p-2 rounded-md transition-all ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-400 hover:bg-[#444] hover:text-white'}`}
            title={title}
        >
            {icon}
        </button>
    );
}

function IconButton({ icon, onClick, disabled, className, title }: any) {
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`p-2 rounded-md transition-colors ${disabled ? 'opacity-30 cursor-not-allowed' : 'hover:bg-[#333] text-gray-300 hover:text-white'} ${className}`}
            title={title}
        >
            {icon}
        </button>
    );
}
