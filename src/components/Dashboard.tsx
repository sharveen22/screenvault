import { useState, useEffect, useCallback, useRef } from "react";
import { useElectronScreenshots } from "../hooks/useElectronScreenshots";
import { Camera, Search, Folder, Star, Trash2, Plus, Upload, FolderOpen } from "lucide-react";
import { Gallery } from "./Gallery";

export function Dashboard() {
  useElectronScreenshots();
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeView, setActiveView] = useState<"all" | "favorites" | "recent" | "archived" | string>("all");
  const [refreshKey, setRefreshKey] = useState(0);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [processingOCR, setProcessingOCR] = useState<Set<string>>(new Set());
  const [folders, setFolders] = useState<any[]>([]);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; folderId: string } | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [screenVaultPath, setScreenVaultPath] = useState<string>("");

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const loadFolders = useCallback(async () => {
    const api = window.electronAPI as any;
    if (!api?.folder?.list) return;
    const { data } = await api.folder.list();
    if (data) setFolders(data);
  }, []);

  useEffect(() => {
    loadFolders();
    (window.electronAPI as any)?.import?.getScreenVaultPath?.().then((r: any) => {
      if (r?.data) setScreenVaultPath(r.data);
    });
  }, [loadFolders]);

  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRefresh = useCallback(() => {
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => setRefreshKey(k => k + 1), 200);
  }, []);

  useEffect(() => {
    const api = window.electronAPI as any;
    if (!api) return;
    const off1 = api.onScreenshotSaved?.(() => triggerRefresh());
    const off2 = api.onScreenshotDeleted?.(() => triggerRefresh());
    const off3 = api.onScreenshotImported?.(() => triggerRefresh());
    const off4 = api.onFolderCreated?.(() => loadFolders());
    const off5 = api.onOCRComplete?.((data: any) => {
      if (data?.screenshotId) setProcessingOCR(prev => { const n = new Set(prev); n.delete(data.screenshotId); return n; });
      triggerRefresh();
    });
    const onLocalSaved = () => triggerRefresh();
    const onOcrComplete = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.screenshotId) setProcessingOCR(prev => { const n = new Set(prev); n.delete(d.screenshotId); return n; });
      triggerRefresh();
    };
    const onOcrStart = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.screenshotId) setProcessingOCR(prev => new Set(prev).add(d.screenshotId));
    };
    window.addEventListener("screenshot-saved-local", onLocalSaved);
    window.addEventListener("ocr-complete", onOcrComplete);
    window.addEventListener("ocr-start", onOcrStart);
    return () => {
      off1?.(); off2?.(); off3?.(); off4?.(); off5?.();
      window.removeEventListener("screenshot-saved-local", onLocalSaved);
      window.removeEventListener("ocr-complete", onOcrComplete);
      window.removeEventListener("ocr-start", onOcrStart);
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    };
  }, [triggerRefresh, loadFolders]);

  const handleImportFiles = async () => { const r = await (window.electronAPI as any)?.import?.files?.(); if (r?.data?.length > 0) triggerRefresh(); };
  const handleImportFolder = async () => { const r = await (window.electronAPI as any)?.import?.folder?.(); if (r?.data) { loadFolders(); triggerRefresh(); } };
  const handleCreateFolder = async (e: React.FormEvent) => { e.preventDefault(); if (!newFolderName.trim()) return; await (window.electronAPI as any)?.folder?.create?.(newFolderName); setNewFolderName(""); setIsCreatingFolder(false); loadFolders(); };
  const handleRenameFolder = async (id: string, newName: string) => { if (!newName.trim()) { setEditingFolderId(null); return; } await (window.electronAPI as any)?.folder?.rename?.(id, newName); setEditingFolderId(null); loadFolders(); };
  const handleDeleteFolder = async (id: string) => { const f = folders.find(x => x.id === id); if (f && window.confirm("Delete " + f.name + "?")) { await (window.electronAPI as any)?.folder?.delete?.(id); if (activeView === id) setActiveView("all"); loadFolders(); } };
  const handleDrop = async (e: React.DragEvent, folderId: string) => { e.preventDefault(); const sid = e.dataTransfer.getData("text/plain"); if (sid) { await (window.electronAPI as any)?.folder?.moveScreenshot?.(sid, folderId); loadFolders(); } };
  const shortcuts = [{ keys: ["⌘", "Shift", "S"], label: "Take Screenshot" }, { keys: ["⌘", "Shift", "A"], label: "Show App" }];

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: "* { margin: 0; padding: 0; box-sizing: border-box; } .blog-container { background-color: #e9e6e4; width: 100%; display: grid; height: 100vh; overflow: hidden; grid-template-columns: 20% 80%; padding: 40px 20px; } .blog-part { padding: 0 20px; } .blog-part:not(:last-child) { border-right: 1px solid #94918f; } .blog-menu { font-size: 14px; color: #161419; display: flex; align-items: center; cursor: pointer; padding: 6px 0; } .blog-menu:hover { opacity: 0.7; } .blog-menu + .blog-menu { margin-top: 12px; } .blog-menu.active { font-weight: 600; } .blog-header-container { overflow-y: auto; height: 100%; display: flex; flex-direction: column; border-right: 1px solid #94918f; padding-top: 20px; }" }} />
      <div className="blog-container">
        <div className="blog-part blog-header-container">
          <div style={{ marginBottom: 40 }}>
            <div className="blog-menu" onClick={() => setActiveView("all")}><Camera size={20} style={{ marginRight: 10 }} />Capture</div>
            <div className="blog-menu" onClick={handleImportFiles} style={{ marginTop: 12 }}><Upload size={20} style={{ marginRight: 10 }} />Import Files</div>
            <div className="blog-menu" onClick={handleImportFolder} style={{ marginTop: 12 }}><FolderOpen size={20} style={{ marginRight: 10 }} />Import Folder</div>
          </div>
          <div style={{ marginBottom: 40 }}>
            <div className={"blog-menu " + (activeView === "all" ? "active" : "")} onClick={() => setActiveView("all")}><Camera size={20} style={{ marginRight: 10 }} />All Screenshots</div>
            <div className={"blog-menu " + (activeView === "favorites" ? "active" : "")} onClick={() => setActiveView("favorites")}><Star size={20} style={{ marginRight: 10 }} />Favorites</div>
          </div>
          <div style={{ marginTop: 20, paddingTop: 20, borderTop: "1px solid #94918f", flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", opacity: 0.6 }}>Folders</div>
              <Plus size={18} style={{ cursor: "pointer", opacity: 0.7 }} onClick={() => setIsCreatingFolder(true)} />
            </div>
            {isCreatingFolder && <form onSubmit={handleCreateFolder} style={{ marginBottom: 16 }}><input autoFocus type="text" value={newFolderName} onChange={e => setNewFolderName(e.target.value)} onBlur={() => { if (!newFolderName.trim()) setIsCreatingFolder(false); }} className="w-full bg-transparent border-b border-black outline-none" placeholder="New folder" style={{ fontSize: 16, padding: "4px 0" }} /></form>}
            <div style={{ flex: 1, overflowY: "auto", marginBottom: 20 }}>
              {folders.map(f => (
                <div key={f.id} className={"blog-menu " + (activeView === f.id ? "active" : "")} style={{ display: "flex", justifyContent: "space-between" }}
                  onClick={() => { if (editingFolderId !== f.id) setActiveView(f.id); }}
                  onDoubleClick={() => { setEditingFolderId(f.id); setEditFolderName(f.name); }}
                  onContextMenu={e => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, folderId: f.id }); }}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("bg-gray-200"); }}
                  onDragLeave={e => e.currentTarget.classList.remove("bg-gray-200")}
                  onDrop={e => { e.currentTarget.classList.remove("bg-gray-200"); handleDrop(e, f.id); }}>
                  <div className="flex items-center"><Folder size={16} style={{ marginRight: 10 }} />{editingFolderId === f.id ? <input autoFocus className="bg-transparent border-b border-black outline-none w-24" value={editFolderName} onChange={e => setEditFolderName(e.target.value)} onBlur={() => handleRenameFolder(f.id, editFolderName)} onKeyDown={e => e.key === "Enter" && handleRenameFolder(f.id, editFolderName)} onClick={e => e.stopPropagation()} /> : f.name}</div>
                  <span style={{ fontSize: 12, opacity: 0.5 }}>{f.screenshot_count || 0}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ paddingTop: 20, borderTop: "1px solid #94918f" }}>
            <div style={{ fontSize: 12, marginBottom: 12, letterSpacing: 1, textTransform: "uppercase", opacity: 0.6 }}>Shortcuts</div>
            {shortcuts.map((s, i) => <div key={i} style={{ marginBottom: 8 }}><div style={{ fontSize: 11, opacity: 0.6, marginBottom: 3 }}>{s.label}</div><div style={{ display: "flex", gap: 3 }}>{s.keys.map((k, j) => <kbd key={j} style={{ backgroundColor: "#161419", color: "#e9e6e4", padding: "3px 6px", borderRadius: 3, fontSize: 10 }}>{k}</kbd>)}</div></div>)}
            {screenVaultPath && <div style={{ marginTop: 16, paddingTop: 16, borderTop: "1px solid #94918f" }}><div style={{ fontSize: 12, marginBottom: 8, opacity: 0.6 }}>Local Folder</div><div onClick={() => (window.electronAPI as any)?.import?.openScreenVaultFolder?.()} style={{ fontSize: 11, opacity: 0.7, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}><FolderOpen size={14} /><span>Open in Finder</span></div></div>}
          </div>
        </div>
        <div className="blog-header-container" style={{ borderRight: "none", padding: 40 }}>
          <div style={{ marginBottom: 30 }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, fontFamily: "Space Grotesk", marginBottom: 12 }}>{activeView === "all" ? "All Screenshots" : activeView === "favorites" ? "Favorites" : folders.find(f => f.id === activeView)?.name || "Screenshots"}</h1>
            <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
              <select value={sortOrder} onChange={e => setSortOrder(e.target.value as any)} style={{ padding: "6px 12px", border: "1px solid #161419", background: "#e9e6e4", fontSize: 13 }}><option value="newest">Newest First</option><option value="oldest">Oldest First</option></select>
              <button onClick={() => setRefreshKey(k => k + 1)} style={{ padding: "6px 12px", border: "1px solid #161419", background: "transparent", fontSize: 13 }}>↻ Reload</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #94918f", paddingBottom: 10 }}><Search size={20} style={{ marginRight: 10, opacity: 0.5 }} /><input type="text" placeholder="Search..." value={searchInput} onChange={e => setSearchInput(e.target.value)} style={{ background: "transparent", border: "none", outline: "none", fontSize: 18, width: "100%" }} /></div>
          </div>
          <Gallery searchQuery={searchQuery} activeView={activeView} sortOrder={sortOrder} processingOCR={processingOCR} refreshTrigger={refreshKey} />
        </div>
      </div>
      {contextMenu && <><div className="fixed inset-0 z-50" onClick={() => setContextMenu(null)} /><div className="fixed z-50 bg-white rounded-lg shadow-xl border py-1 w-48" style={{ top: contextMenu.y, left: contextMenu.x }}><button onClick={() => { const f = folders.find(x => x.id === contextMenu.folderId); if (f) { setEditingFolderId(f.id); setEditFolderName(f.name); } setContextMenu(null); }} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-100">Rename</button><button onClick={() => { handleDeleteFolder(contextMenu.folderId); setContextMenu(null); }} className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"><Trash2 className="w-4 h-4" />Delete</button></div></>}
    </>
  );
}
