/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { Wand2, Image as ImageIcon, Zap, Crown, Star, LogOut, User as UserIcon, Download, Share2, Move, Type, Layers, Play, Video, Trash2, History, Lock, Key, X, ArrowRight, Layout, Plus, Copy, Search, Upload, Eye, Pipette, Mail, Camera, QrCode } from 'lucide-react';
import { motion } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { QRCodeCanvas } from 'qrcode.react';
import { Html5Qrcode } from 'html5-qrcode';
import { auth, db } from './firebase';
import firebaseConfig from '../firebase-applet-config.json';
import { viralLayouts } from './viralLayouts';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  User as FirebaseUser
} from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  onSnapshot,
  collection,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { toast, Toaster } from 'sonner';
import Konva from 'konva';
import { Stage, Layer, Image as KonvaImage, Text as KonvaText, Transformer, Rect } from 'react-konva';
import { Html } from 'react-konva-utils';
import useImage from 'use-image';
import confetti from 'canvas-confetti';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import React, { Component, ErrorInfo, ReactNode } from 'react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Error Boundary Component
interface EBProps {
  children: ReactNode;
}

interface EBState {
  hasError: boolean;
}

class ErrorBoundary extends Component<EBProps, EBState> {
  public state: EBState = {
    hasError: false
  };

  public static getDerivedStateFromError(_: Error): EBState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-black text-white flex items-center justify-center p-4 text-center">
          <div className="max-w-md">
            <div className="w-16 h-16 bg-red-500/20 text-red-500 rounded-full flex items-center justify-center mx-auto mb-6">
              <X size={32} />
            </div>
            <h1 className="text-2xl font-bold mb-4">Something went wrong.</h1>
            <p className="text-zinc-400 mb-8">The application encountered an error. This is often caused by browser storage limits being exceeded by high-resolution images.</p>
            <div className="space-y-3">
              <button 
                onClick={() => {
                  localStorage.removeItem('minethumb_history');
                  window.location.reload();
                }}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold transition-colors"
              >
                Clear History & Reload
              </button>
              <button 
                onClick={() => {
                  localStorage.clear();
                  window.location.reload();
                }}
                className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold transition-colors"
              >
                Reset All Data
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Firestore Error Handling
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Safe LocalStorage Wrapper
const safeLocalStorage = {
  setItem: (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      if (e instanceof DOMException && (
        e.code === 22 || 
        e.code === 1014 || 
        e.name === 'QuotaExceededError' || 
        e.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      )) {
        console.warn('LocalStorage quota exceeded. Pruning data...');
        if (key === 'minethumb_history') {
          try {
            const history = JSON.parse(value);
            if (Array.isArray(history) && history.length > 1) {
              // Keep only the 5 most recent items if quota is hit
              const pruned = history.slice(0, 5);
              localStorage.setItem(key, JSON.stringify(pruned));
              return;
            }
          } catch (parseError) {
            localStorage.removeItem(key);
          }
        } else {
          // For other keys, try clearing history first as it's the biggest culprit
          localStorage.removeItem('minethumb_history');
          try {
            localStorage.setItem(key, value);
          } catch (retryError) {
            console.error('Failed to set item even after clearing history', retryError);
          }
        }
      }
    }
  },
  getItem: (key: string) => {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
};

// Mock User Type
interface DailyUsage {
  '1K': number;
  '2K': number;
  '4K': number;
  '8K': number;
  total: number;
}

interface MockUser {
  uid: string;
  email: string;
  displayName?: string;
  plan: 'Free' | 'Premium' | 'Max';
  coins: number;
  dailyUsage: DailyUsage;
  lastResetDate: string; // ISO date string
  subscriptionEndDate?: string | null; // ISO date string
  lastRedeemedCode?: string | null;
}

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

interface CanvasElement {
  id: string;
  type: 'image' | 'text';
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  fill?: string;
  src?: string;
  rotation?: number;
}

interface CustomLayout {
  id: string;
  name: string;
  category?: string;
  elements: CanvasElement[];
}

const URLImage = ({ src, x, y, width, height, id, onSelect, isSelected, onChange, blurRadius = 0 }: any) => {
  const [image] = useImage(src, 'anonymous');
  const shapeRef = useRef<any>();
  const trRef = useRef<any>();

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  useEffect(() => {
    if (shapeRef.current && image) {
      if (blurRadius > 0) {
        shapeRef.current.cache();
      } else {
        shapeRef.current.clearCache();
      }
    }
  }, [image, blurRadius, width, height]);

  return (
    <>
      <KonvaImage
        image={image}
        x={x}
        y={y}
        width={width}
        height={height}
        id={id}
        ref={shapeRef}
        onClick={onSelect}
        onTap={onSelect}
        draggable={id !== 'bg'}
        filters={blurRadius > 0 ? [Konva.Filters.Blur] : []}
        blurRadius={blurRadius}
        onDragEnd={(e) => {
          onChange({
            x: e.target.x(),
            y: e.target.y(),
          });
        }}
        onTransformEnd={(e) => {
          const node = shapeRef.current;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            x: node.x(),
            y: node.y(),
            width: Math.max(5, node.width() * scaleX),
            height: Math.max(node.height() * scaleY),
            rotation: node.rotation(),
          });
        }}
      />
      {isSelected && id !== 'bg' && (
        <Transformer
          ref={trRef}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 5 || newBox.height < 5) {
              return oldBox;
            }
            return newBox;
          }}
        />
      )}
    </>
  );
};

const EditableText = ({ text, x, y, fontSize, fill, id, onSelect, isSelected, onChange }: any) => {
  const shapeRef = useRef<any>();
  const trRef = useRef<any>();
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(text);

  useEffect(() => {
    if (isSelected) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  const handleDblClick = () => {
    setIsEditing(true);
  };

  const handleBlur = () => {
    setIsEditing(false);
    onChange({ text: inputValue });
  };

  const handleKeyDown = (e: any) => {
    if (e.key === 'Enter') {
      setIsEditing(false);
      onChange({ text: inputValue });
    }
  };

  return (
    <>
      <KonvaText
        text={text}
        x={x}
        y={y}
        fontSize={fontSize}
        fill={fill}
        id={id}
        ref={shapeRef}
        onClick={onSelect}
        onTap={onSelect}
        onDblClick={handleDblClick}
        onDblTap={handleDblClick}
        draggable
        visible={!isEditing}
        onDragEnd={(e) => {
          onChange({
            x: e.target.x(),
            y: e.target.y(),
          });
        }}
        onTransformEnd={(e) => {
          const node = shapeRef.current;
          const scaleX = node.scaleX();
          node.scaleX(1);
          onChange({
            x: node.x(),
            y: node.y(),
            fontSize: node.fontSize() * scaleX,
            rotation: node.rotation(),
          });
        }}
      />
      {isEditing && (
        <Html
          divProps={{
            style: {
              position: 'absolute',
              top: `${y}px`,
              left: `${x}px`,
            },
          }}
        >
          <input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            autoFocus
            style={{
              fontSize: `${fontSize}px`,
              color: fill,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              padding: 0,
              margin: 0,
              fontFamily: 'sans-serif',
              fontWeight: 'bold',
            }}
          />
        </Html>
      )}
      {isSelected && !isEditing && (
        <Transformer
          ref={trRef}
          enabledAnchors={['middle-left', 'middle-right', 'top-left', 'top-right', 'bottom-left', 'bottom-right']}
          boundBoxFunc={(oldBox, newBox) => {
            newBox.width = Math.max(30, newBox.width);
            return newBox;
          }}
        />
      )}
    </>
  );
};

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

const HistoryView = ({ 
  history, 
  setHistory, 
  isModal, 
  onClose,
  setGeneratedImage,
  setGeneratedVideo,
  setShowModal
}: { 
  history: string[], 
  setHistory: React.Dispatch<React.SetStateAction<string[]>>, 
  isModal?: boolean, 
  onClose?: () => void,
  setGeneratedImage: (img: string | null) => void,
  setGeneratedVideo: (vid: string | null) => void,
  setShowModal: (modal: any) => void
}) => {
  return (
    <div className={isModal ? "" : "max-w-6xl mx-auto"}>
      <div className="flex justify-between items-center mb-8">
        {!isModal && (
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-600 rounded-lg">
              <History size={24} className="text-white" />
            </div>
            <h1 className="text-3xl font-bold">Your Generation History</h1>
          </div>
        )}
        <div className="flex items-center gap-4 ml-auto">
          {history.length > 0 && (
            <button 
              onClick={() => {
                setShowModal({
                  title: 'Clear History',
                  message: 'Are you sure you want to clear all generation history? This action cannot be undone.',
                  type: 'confirm',
                  onConfirm: () => {
                    setHistory([]);
                    setShowModal(null);
                    toast.success('History cleared');
                  }
                });
              }}
              className="px-4 py-2 bg-red-600/10 text-red-500 hover:bg-red-600/20 rounded-xl text-sm font-bold transition-colors"
            >
              Clear All
            </button>
          )}
          {!isModal && (
            <button 
              onClick={onClose} 
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-sm font-bold transition-colors"
            >
              Close Window
            </button>
          )}
        </div>
      </div>

      {history.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-32 text-zinc-500 bg-zinc-900/50 rounded-3xl border border-zinc-800 border-dashed">
          <ImageIcon size={64} className="mb-4 opacity-20" />
          <p className="text-xl font-medium">No photos in your history yet.</p>
          <p className="text-sm">Your generated thumbnails will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {history.map((item, idx) => {
            const isVideo = item.startsWith('blob:') || item.includes('.mp4') || item.includes('veo');
            return (
              <div key={idx} className="group relative aspect-video bg-zinc-900 rounded-2xl overflow-hidden border border-zinc-800 hover:border-emerald-500/50 transition-all shadow-lg">
                {isVideo ? (
                  <video src={item} className="w-full h-full object-cover" />
                ) : (
                  <img src={item} alt={`History ${idx}`} className="w-full h-full object-cover" />
                )}
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-3">
                  <button 
                    onClick={() => {
                      if (isVideo) {
                        setGeneratedVideo(item);
                        setGeneratedImage(null);
                      } else {
                        setGeneratedImage(item);
                        setGeneratedVideo(null);
                      }
                      if (onClose) onClose();
                    }}
                    className="p-3 bg-blue-600 hover:bg-blue-500 rounded-xl text-white shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all"
                    title="View"
                  >
                    <Eye size={20} />
                  </button>
                  <button 
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = item;
                      link.download = isVideo ? `video-${idx}.mp4` : `minethumb-${idx}.png`;
                      link.click();
                    }}
                    className="p-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-white shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all"
                    title="Download"
                  >
                    <Download size={20} />
                  </button>
                  <button 
                    onClick={() => {
                      setShowModal({
                        title: 'Delete Item',
                        message: 'Remove this item from your history?',
                        type: 'confirm',
                        onConfirm: () => {
                          setHistory(prev => prev.filter((_, i) => i !== idx));
                          setShowModal(null);
                        }
                      });
                    }}
                    className="p-3 bg-red-600 hover:bg-red-500 rounded-xl text-white shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-all delay-75"
                    title="Delete"
                  >
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-12 p-6 bg-zinc-900/30 rounded-2xl border border-zinc-800 text-center">
        <p className="text-zinc-500 text-sm italic">
          History is stored locally in your browser. Clearing your browser cache may remove these images.
        </p>
      </div>
    </div>
  );
};

function App() {
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('16:9');
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash-image');
  const [imageSize, setImageSize] = useState('1K');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [generatedVideo, setGeneratedVideo] = useState<string | null>(null);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [videoProgress, setVideoProgress] = useState('');
  const [history, setHistory] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = safeLocalStorage.getItem('minethumb_history');
      try {
        return saved ? JSON.parse(saved) : [];
      } catch (e) {
        return [];
      }
    }
    return [];
  });
  const [hasApiKey, setHasApiKey] = useState(true);

  const [isHistoryPage, setIsHistoryPage] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('view') === 'history') {
      setIsHistoryPage(true);
    }
  }, []);

  useEffect(() => {
    safeLocalStorage.setItem('minethumb_history', JSON.stringify(history));
  }, [history]);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Generating...');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loginStep, setLoginStep] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthProcessing, setIsAuthProcessing] = useState(false);
  const [user, setUser] = useState<MockUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [showPlans, setShowPlans] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);
  const [showModal, setShowModal] = useState<{ title: string; message: string; onConfirm?: () => void; type: 'alert' | 'confirm' } | null>(null);
  const [currentPlan, setCurrentPlan] = useState<'Free' | 'Premium' | 'Max'>('Free');
  const [subscriptionEndDate, setSubscriptionEndDate] = useState<string | null>(null);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemError, setRedeemError] = useState<string | null>(null);
  const [profileColor, setProfileColor] = useState('bg-emerald-600');
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [adminPassword, setAdminPassword] = useState('');
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(true);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [allRedeemCodes, setAllRedeemCodes] = useState<any[]>([]);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [selectedCodePlan, setSelectedCodePlan] = useState<'Premium' | 'Max'>('Premium');
  const [showQRModal, setShowQRModal] = useState<string | null>(null);
  const [showQRScanner, setShowQRScanner] = useState(false);
  const [qrScannerError, setQrScannerError] = useState<string | null>(null);
  const qrScannerRef = useRef<Html5Qrcode | null>(null);
  const [activeTab, setActiveTab] = useState<'thumbnail' | 'faceswap' | 'edit'>('thumbnail');
  const [thumbnailCategory, setThumbnailCategory] = useState<'Minecraft' | 'GTA V' | 'Free Fire Max' | 'PUBG' | 'Real Life'>('Minecraft');
  const [canvasElements, setCanvasElements] = useState<CanvasElement[]>([]);
  const [customLayouts, setCustomLayouts] = useState<CustomLayout[]>(() => {
    const saved = safeLocalStorage.getItem('minethumb_custom_layouts');
    return saved ? JSON.parse(saved) : [];
  });
  const [layoutSearchQuery, setLayoutSearchQuery] = useState('');
  const layoutFileInputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [coins, setCoins] = useState(0);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage>({ '1K': 0, '2K': 0, '4K': 0, '8K': 0, total: 0 });
  const [isWatchingAd, setIsWatchingAd] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const colors = [
      'bg-emerald-600', 'bg-blue-600', 'bg-purple-600', 'bg-rose-600', 
      'bg-amber-600', 'bg-indigo-600', 'bg-cyan-600', 'bg-orange-600'
    ];
    setProfileColor(colors[Math.floor(Math.random() * colors.length)]);
  }, [isLoggedIn]);

  useEffect(() => {
    if (currentPlan !== 'Free') {
      setSelectedPlan(currentPlan);
    }
  }, [currentPlan]);

  useEffect(() => {
    if (showAdminPanel && user?.email === 'indiafff568@gmail.com') {
      const q = query(collection(db, 'redeem_codes'), orderBy('createdAt', 'desc'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const codes = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setAllRedeemCodes(codes);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'redeem_codes');
      });
      return () => unsubscribe();
    }
  }, [showAdminPanel, user]);

  const deleteRedeemCode = async (codeId: string) => {
    setShowModal({
      title: 'Delete Code',
      message: 'Are you sure you want to delete this redeem code?',
      type: 'confirm',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'redeem_codes', codeId)).catch(e => handleFirestoreError(e, OperationType.DELETE, `redeem_codes/${codeId}`));
          setShowModal({ title: 'Deleted', message: 'Redeem code has been removed.', type: 'alert' });
        } catch (error: any) {
          console.error("Error deleting code:", error);
          toast.error('Failed to delete code');
        }
      }
    });
  };

  const stageRef = useRef<any>(null);
  useEffect(() => {
    safeLocalStorage.setItem('minethumb_custom_layouts', JSON.stringify(customLayouts));
  }, [customLayouts]);

  const saveCurrentLayout = () => {
    if (canvasElements.length === 0) {
      setShowModal({ title: 'Empty Layout', message: 'Add some elements to the canvas first!', type: 'alert' });
      return;
    }
    const name = window.prompt('Enter a name for this layout:');
    if (name) {
      const newLayout: CustomLayout = {
        id: Date.now().toString(),
        name,
        elements: JSON.parse(JSON.stringify(canvasElements))
      };
      setCustomLayouts(prev => [...prev, newLayout]);
    }
  };

  const renameLayout = (id: string) => {
    const layout = customLayouts.find(l => l.id === id);
    if (!layout) return;
    const newName = window.prompt('Enter new name for layout:', layout.name);
    if (newName && newName.trim()) {
      setCustomLayouts(prev => prev.map(l => l.id === id ? { ...l, name: newName.trim() } : l));
    }
  };

  const deleteLayout = (id: string) => {
    setCustomLayouts(prev => prev.filter(l => l.id !== id));
  };

  const handleUploadLayout = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        const newLayout: CustomLayout = {
          id: Date.now().toString(),
          name: file.name.replace(/\.[^/.]+$/, ""),
          category: 'Uploaded PNGs',
          elements: [
            {
              id: Date.now().toString(),
              type: 'image',
              x: 0,
              y: 0,
              width: 1280,
              height: 720,
              src: dataUrl,
              rotation: 0
            }
          ]
        };
        setCustomLayouts(prev => [...prev, newLayout]);
        setShowModal({ title: 'Success', message: 'Image layout uploaded successfully!', type: 'alert' });
      };
      reader.readAsDataURL(file);
    } else {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const content = event.target?.result as string;
          const layout = JSON.parse(content);
          if (layout && layout.elements && Array.isArray(layout.elements)) {
            const newLayout: CustomLayout = {
              id: Date.now().toString(),
              name: layout.name || `Uploaded Layout ${customLayouts.length + 1}`,
              category: layout.category || 'Uploaded JSONs',
              elements: layout.elements
            };
            setCustomLayouts(prev => [...prev, newLayout]);
            setShowModal({ title: 'Success', message: 'Layout uploaded successfully!', type: 'alert' });
          } else {
            throw new Error('Invalid layout format');
          }
        } catch (err) {
          setShowModal({ title: 'Error', message: 'Failed to parse layout file. Ensure it is a valid JSON layout.', type: 'alert' });
        }
      };
      reader.readAsText(file);
    }
    if (layoutFileInputRef.current) {
      layoutFileInputRef.current.value = '';
    }
  };

  const openHistoryWindow = () => {
    setShowHistoryModal(true);
  };

  const availableModels = [
    { id: 'gemini-2.5-flash-image', name: 'Nano Banana Premium', description: 'Fast Thumbnail Generator', plan: 'Premium' },
    { id: 'gemini-2.5-flash-image-promax', name: 'Nano Banana Pro Max', description: 'Ultra fast Thumbnail Generator', plan: 'Max' },
    { id: 'veo-3.1-fast-generate-preview', name: 'Gemini Video', description: '720p Cinematic', plan: 'Max' },
  ];

  const plans = [
    { 
      name: 'Free', 
      price: '₹0', 
      color: 'bg-zinc-800', 
      icon: <Zap size={18} />, 
      features: ['3 Photos/Day', '1K Resolution', 'Watch Ads for Coins', 'Upgrade for Nano Banana 2.5'],
      limits: { '1K': 3, '2K': 0, '4K': 0, '8K': 0 }
    },
    { 
      name: 'Premium', 
      price: '₹299/mo', 
      color: 'bg-amber-600', 
      icon: <Star size={18} />, 
      features: ['Nano Banana 2.5 Premium', '101 Photos (1K)/Day', '50 Photos (2K)/Day', 'Face Swap Edit'],
      limits: { '1K': 101, '2K': 50, '4K': 25, '8K': 0 }
    },
    { 
      name: 'Max', 
      price: '₹599/mo', 
      color: 'bg-purple-600', 
      icon: <Crown size={18} />, 
      features: ['Nano Banana 2.5 Pro Max', '250 Photos (4K)/Day', '101 Photos (8K)/Day', 'Unlimited 1K/2K'],
      limits: { '1K': 9999, '2K': 9999, '4K': 250, '8K': 101 }
    },
  ];

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        try {
          const userPath = `users/${firebaseUser.uid}`;
          const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid)).catch(e => handleFirestoreError(e, OperationType.GET, userPath));
          if (userDoc && userDoc.exists()) {
            const userData = userDoc.data() as MockUser;
            const resetUser = resetDailyLimits(userData);
            if (resetUser.lastResetDate !== userData.lastResetDate) {
              await setDoc(doc(db, 'users', firebaseUser.uid), resetUser).catch(e => handleFirestoreError(e, OperationType.WRITE, userPath));
            }
            setUser(resetUser);
            setCurrentPlan(resetUser.plan);
            setCoins(resetUser.coins);
            setDailyUsage(resetUser.dailyUsage);
            setSubscriptionEndDate(resetUser.subscriptionEndDate || null);
          } else {
            const newUser: MockUser = {
              uid: firebaseUser.uid,
              email: firebaseUser.email || '',
              plan: 'Free',
              coins: 3,
              dailyUsage: { '1K': 0, '2K': 0, '4K': 0, '8K': 0, total: 0 },
              lastResetDate: new Date().toISOString().split('T')[0]
            };
            await setDoc(doc(db, 'users', firebaseUser.uid), newUser).catch(e => handleFirestoreError(e, OperationType.WRITE, userPath));
            setUser(newUser);
            setCurrentPlan('Free');
            setCoins(3);
          }
          setIsLoggedIn(true);
        } catch (error) {
          console.error("Auth state change error:", error);
        }
      } else {
        setIsLoggedIn(false);
        setUser(null);
      }
      setAuthLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const resetDailyLimits = (userObj: MockUser): MockUser => {
    const today = new Date().toISOString().split('T')[0];
    if (userObj.lastResetDate !== today) {
      return {
        ...userObj,
        dailyUsage: { '1K': 0, '2K': 0, '4K': 0, '8K': 0, total: 0 },
        coins: userObj.plan === 'Free' ? 3 : userObj.coins,
        lastResetDate: today
      };
    }
    return userObj;
  };

  const handleDownload = () => {
    if (generatedVideo) {
      const link = document.createElement('a');
      link.download = 'gemini-video.mp4';
      link.href = generatedVideo;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      return;
    }
    if (!stageRef.current) return;
    const uri = stageRef.current.toDataURL();
    const link = document.createElement('a');
    link.download = 'minethumb-thumbnail.png';
    link.href = uri;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleShare = async () => {
    if (!stageRef.current) return;
    try {
      const uri = stageRef.current.toDataURL();
      let blob: Blob;
      if (uri.startsWith('data:')) {
        const byteString = atob(uri.split(',')[1]);
        const mimeString = uri.split(',')[0].split(':')[1].split(';')[0];
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) {
          ia[i] = byteString.charCodeAt(i);
        }
        blob = new Blob([ab], { type: mimeString });
      } else {
        blob = await (await fetch(uri)).blob();
      }
      const file = new File([blob], 'thumbnail.png', { type: 'image/png' });
      if (navigator.share) {
        await navigator.share({
          files: [file],
          title: 'My Minecraft Thumbnail',
          text: 'Check out this thumbnail I made with MineThumb AI!',
        });
      } else {
        toast.info('Sharing is not supported on this browser. You can download the image instead.');
      }
    } catch (error) {
      console.error('Error sharing:', error);
    }
  };

  const addTextToCanvas = () => {
    const newText: CanvasElement = {
      id: 'text-' + Date.now(),
      type: 'text',
      x: 100,
      y: 100,
      text: 'New Text',
      fontSize: 40,
      fill: '#ffffff',
    };
    setCanvasElements([...canvasElements, newText]);
  };

  const addImageToCanvas = (src: string) => {
    const newImg: CanvasElement = {
      id: 'img-' + Date.now(),
      type: 'image',
      x: 50,
      y: 50,
      width: 200,
      height: 200,
      src: src,
    };
    setCanvasElements([...canvasElements, newImg]);
  };

  const handleCanvasChange = (id: string, newAttrs: Partial<CanvasElement>) => {
    setCanvasElements(canvasElements.map(el => el.id === id ? { ...el, ...newAttrs } : el));
  };

  const getApiKey = (isPremiumModel: boolean) => {
    const win = window as any;
    // Try to get from platform-injected locations first (runtime)
    const runtimeKey = win.process?.env?.API_KEY || win.process?.env?.GEMINI_API_KEY;
    
    // Fallback to build-time variables
    const buildTimeKey = process.env.API_KEY || process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_API_KEY || (import.meta as any).env?.GEMINI_API_KEY;

    // Filter out placeholder strings
    const isValidKey = (key: any) => key && typeof key === 'string' && key.length > 10 && !key.includes('YOUR_') && !key.includes('MY_');

    if (isValidKey(runtimeKey)) return runtimeKey;
    if (isValidKey(buildTimeKey)) return buildTimeKey;
    
    // No valid key found
    throw new Error('No valid Gemini API key found. Please configure GEMINI_API_KEY in your environment variables.');
  };

  const handleForgotPassword = () => {
    setShowModal({ title: 'Reset Password', message: 'Password reset link has been sent to your email (simulated).', type: 'alert' });
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsAuthProcessing(true);

    if (loginStep === 'register') {
      if (password !== confirmPassword) {
        setAuthError('Passwords do not match');
        setIsAuthProcessing(false);
        return;
      }
      if (password.length < 6) {
        setAuthError('Password should be at least 6 characters');
        setIsAuthProcessing(false);
        return;
      }
    }

    try {
      let userCredential;
      if (loginStep === 'register') {
        userCredential = await createUserWithEmailAndPassword(auth, email, password);
        
        // Handle auto-matching plans via referral code
        let initialPlan: 'Free' | 'Premium' | 'Max' = 'Free';
        const code = referralCode.trim().toUpperCase();
        if (code === 'PXTER') initialPlan = 'Premium';
        if (code === 'MAXIOP') initialPlan = 'Max';

        const newUser: MockUser = {
          uid: userCredential.user.uid,
          email: userCredential.user.email || '',
          displayName: userCredential.user.email?.split('@')[0] || 'User',
          plan: initialPlan,
          coins: initialPlan === 'Free' ? 3 : 100,
          dailyUsage: { '1K': 0, '2K': 0, '4K': 0, '8K': 0, total: 0 },
          lastResetDate: new Date().toISOString().split('T')[0]
        };
        await setDoc(doc(db, 'users', userCredential.user.uid), newUser);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error: any) {
      let message = error.message;
      if (error.code === 'auth/email-already-in-use') message = 'This account is already in use. Try logging in.';
      if (error.code === 'auth/invalid-email') message = 'Invalid email address';
      if (error.code === 'auth/weak-password') message = 'Password should be at least 6 characters';
      if (error.code === 'auth/user-not-found') message = 'User not found. Please register first.';
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') message = 'Incorrect password. Please try again.';
      setAuthError(message);
    } finally {
      setIsAuthProcessing(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsAuthProcessing(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error: any) {
      let message = error.message;
      if (error.code === 'auth/account-exists-with-different-credential') {
        message = 'This account is already in use with a different login method. Please use your email and password.';
      } else if (error.code === 'auth/email-already-in-use') {
        message = 'This email is already associated with another account.';
      } else if (error.code === 'auth/popup-closed-by-user') {
        message = 'Login cancelled. Please try again.';
      }
      setAuthError(message);
    } finally {
      setIsAuthProcessing(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setShowProfile(false);
  };

  const [showMandatoryUpgrade, setShowMandatoryUpgrade] = useState(false);

  useEffect(() => {
    const checkExpiry = async () => {
      if (isLoggedIn && user) {
        // Special logic for admin user to have 1 month Max subscription
        if (user.email === 'indiafff568@gmail.com' && (!user.subscriptionEndDate || user.plan !== 'Max')) {
          const oneMonthEnd = new Date(currentTime.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
          const updatedUser: MockUser = { 
            ...user, 
            plan: 'Max',
            subscriptionEndDate: oneMonthEnd 
          };
          await setDoc(doc(db, 'users', user.uid), updatedUser);
          setUser(updatedUser);
          setCurrentPlan('Max');
          setSubscriptionEndDate(oneMonthEnd);
          return;
        }

        const isExpired = user.subscriptionEndDate ? currentTime > new Date(user.subscriptionEndDate) : false;
        
        if (isExpired && user.plan !== 'Free') {
          // Auto-reset to Free plan in database
          const updatedUser: MockUser = { 
            ...user, 
            plan: 'Free',
            subscriptionEndDate: null 
          };
          await setDoc(doc(db, 'users', user.uid), updatedUser);
          setUser(updatedUser);
          setCurrentPlan('Free');
          setSubscriptionEndDate(null);
          setShowMandatoryUpgrade(true);
          return;
        }

        if (user.plan === 'Free' || isExpired) {
          setShowMandatoryUpgrade(true);
        } else {
          setShowMandatoryUpgrade(false);
        }
      }
    };
    checkExpiry();
  }, [isLoggedIn, user, currentTime]);

  const updatePlan = async (planName: 'Free' | 'Premium' | 'Max') => {
    if (user) {
      const end = new Date();
      end.setDate(end.getDate() + 30);
      const endDateStr = end.toISOString();

      const updatedUser: MockUser = { 
        ...user, 
        plan: planName,
        subscriptionEndDate: planName === 'Free' ? null : endDateStr,
        // Give some starter coins if upgrading from Free
        coins: planName !== 'Free' ? Math.max(user.coins, 100) : user.coins 
      };
      const userPath = `users/${user.uid}`;
      await setDoc(doc(db, 'users', user.uid), updatedUser).catch(e => handleFirestoreError(e, OperationType.WRITE, userPath));
      setUser(updatedUser);
      setCurrentPlan(planName);
      setCoins(updatedUser.coins);
      setSubscriptionEndDate(updatedUser.subscriptionEndDate || null);
      setShowPlans(false);
      setShowMandatoryUpgrade(false);
      confetti({
        particleCount: 150,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#10b981', '#34d399', '#6ee7b7']
      });
    }
  };

  const startScanner = async () => {
    setQrScannerError(null);
    setShowQRScanner(true);
    setTimeout(async () => {
      try {
        const scanner = new Html5Qrcode("qr-reader");
        qrScannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
          },
          (decodedText) => {
            setRedeemCode(decodedText);
            stopScanner();
            toast.success("QR Code scanned successfully!");
          },
          (errorMessage) => {
            // Ignore common errors like "No QR code found"
          }
        );
      } catch (err: any) {
        setQrScannerError(err.message || "Failed to start camera");
        console.error("QR Scanner Error:", err);
      }
    }, 100);
  };

  const stopScanner = async () => {
    if (qrScannerRef.current) {
      try {
        await qrScannerRef.current.stop();
        qrScannerRef.current = null;
      } catch (err) {
        console.error("Failed to stop scanner:", err);
      }
    }
    setShowQRScanner(false);
  };

  const handleGalleryScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const scanner = new Html5Qrcode("qr-reader-hidden");
    try {
      const decodedText = await scanner.scanFile(file, true);
      setRedeemCode(decodedText);
      stopScanner();
      toast.success("QR Code scanned from gallery!");
    } catch (err: any) {
      toast.error("No QR code found in this image.");
      console.error("Gallery scan error:", err);
    }
  };

  const generateRedeemCode = async () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 69; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    const finalCode = code; // No prefix to keep it exactly 69 chars as requested
    setGeneratedCode(finalCode);
    
    // Store in Firestore so it can be redeemed
    try {
      const codePath = `redeem_codes/${finalCode}`;
      await setDoc(doc(db, 'redeem_codes', finalCode), {
        code: finalCode,
        plan: selectedCodePlan,
        createdAt: serverTimestamp(),
        isUsed: false,
        createdBy: user?.email || 'admin',
        oneTimeUse: true // Explicitly mark as one-time use
      }).catch(e => handleFirestoreError(e, OperationType.WRITE, codePath));
      setShowModal({ title: 'Success', message: `Code ${finalCode} generated and saved successfully!`, type: 'alert' });
    } catch (error: any) {
      console.error("Error saving redeem code:", error);
      setShowModal({ title: 'Error', message: `Failed to save code: ${error.message}`, type: 'alert' });
    }
  };

  const [isRedeeming, setIsRedeeming] = useState(false);

  const handleRedeem = async () => {
    if (!redeemCode || !user) return;
    const code = redeemCode.trim().toUpperCase();
    setRedeemError(null);
    setIsRedeeming(true);
    
    // Check Firestore first
    try {
      const codePath = `redeem_codes/${code}`;
      const codeDoc = await getDoc(doc(db, 'redeem_codes', code)).catch(e => handleFirestoreError(e, OperationType.GET, codePath));
      if (codeDoc && codeDoc.exists()) {
        const data = codeDoc.data();
        if (data.isUsed) {
          setRedeemError('This code has already been used.');
          setIsRedeeming(false);
          return;
        }
        
        const plan = data.plan as 'Premium' | 'Max';
        
        // Calculate new end date (stacking logic)
        let newEndDate = new Date();
        const now = new Date();
        
        if (user?.subscriptionEndDate) {
          const currentEnd = new Date(user.subscriptionEndDate);
          // If current subscription is still active, add to it. Otherwise start from now.
          if (currentEnd > now) {
            newEndDate = currentEnd;
          }
        }
        
        // Add 30 days to the base date (either current end date or now)
        newEndDate.setDate(newEndDate.getDate() + 30);
        const endDateStr = newEndDate.toISOString();
        
        if (user) {
          const updatedUser: MockUser = { 
            ...user, 
            plan,
            subscriptionEndDate: endDateStr,
            coins: Math.max(user.coins, plan === 'Max' ? 2000 : 500),
            lastRedeemedCode: code
          };

          const batch = writeBatch(db);
          
          // 1. Update User Profile
          const userRef = doc(db, 'users', user.uid);
          batch.set(userRef, updatedUser);

          // 2. Mark the code as used
          const codeRef = doc(db, 'redeem_codes', code);
          batch.update(codeRef, {
            isUsed: true,
            usedBy: user.email,
            usedAt: serverTimestamp()
          });

          // 3. Add to Redemption History
          const historyRef = doc(collection(db, 'users', user.uid, 'redemptions'), code);
          batch.set(historyRef, {
            code,
            plan,
            redeemedAt: serverTimestamp(),
            previousPlan: user.plan,
            newEndDate: endDateStr
          });

          await batch.commit().catch(e => {
            console.error("Batch redemption failed:", e);
            throw e;
          });
          
          setUser(updatedUser);
          setCurrentPlan(plan);
          setSubscriptionEndDate(endDateStr);
          setCoins(updatedUser.coins);
          setShowRedeem(false);
          setShowMandatoryUpgrade(false);
          setRedeemCode('');
          
          confetti({
            particleCount: 150,
            spread: 70,
            origin: { y: 0.6 },
            colors: ['#10b981', '#34d399', '#6ee7b7']
          });
          
          setShowModal({ title: 'Success!', message: `${plan} plan activated! Your subscription has been extended by 30 days.`, type: 'alert' });
          setIsRedeeming(false);
          return;
        }
      } else {
        setRedeemError('Invalid code. Please check the code and try again.');
      }
    } catch (error: any) {
      console.error("Error checking redeem code:", error);
      setRedeemError(`Error: ${error.message}`);
    } finally {
      setIsRedeeming(false);
    }
  };

  const watchAd = () => {
    setIsWatchingAd(true);
    setTimeout(() => {
      if (user) {
        const updatedUser = { ...user, coins: (user.coins || 0) + 1 };
        safeLocalStorage.setItem('minethub_user', JSON.stringify(updatedUser));
        setUser(updatedUser);
        setCoins(updatedUser.coins);
      }
      setIsWatchingAd(false);
      setShowModal({ title: 'Reward', message: 'Ad watched! You earned 1 coin.', type: 'alert' });
    }, 3000);
  };

  const checkLimits = (size: string): boolean => {
    if (!user) return false;
    const plan = plans.find(p => p.name === currentPlan);
    if (!plan) return false;

    if (currentPlan === 'Free') {
      if (coins <= 0) {
        setShowModal({ 
          title: 'Out of Coins', 
          message: 'You are out of coins! Watch an ad or upgrade to continue.', 
          type: 'confirm',
          onConfirm: () => {
            setShowModal(null);
            setShowPlans(true);
          }
        });
        return false;
      }
      return true;
    }

    const limit = (plan.limits as any)[size];
    const current = (dailyUsage as any)[size];

    if (current >= limit) {
      setShowModal({ 
        title: 'Limit Reached', 
        message: `Daily limit reached for ${size} resolution on ${currentPlan} plan. Upgrade for more!`, 
        type: 'confirm',
        onConfirm: () => {
          setShowModal(null);
          setShowPlans(true);
        }
      });
      return false;
    }

    return true;
  };

  const recordGeneration = async (size: string) => {
    if (!user) return;
    const updatedUsage = { ...dailyUsage, [size]: (dailyUsage as any)[size] + 1, total: dailyUsage.total + 1 };
    const updatedCoins = currentPlan === 'Free' ? coins - 1 : coins;
    
    const updatedUser = { ...user, dailyUsage: updatedUsage, coins: updatedCoins };
    await updateDoc(doc(db, 'users', user.uid), {
      dailyUsage: updatedUsage,
      coins: updatedCoins
    });
    setUser(updatedUser);
    setDailyUsage(updatedUsage);
    setCoins(updatedCoins);
  };

  const addToHistory = (imageUrl: string) => {
    setHistory(prev => [imageUrl, ...prev].slice(0, 10)); // Reduced to 10 to save space
  };

  const addLiveBadge = () => {
    const id = `live-${Date.now()}`;
    const badge: CanvasElement = {
      id,
      type: 'text',
      text: '● LIVE',
      x: 30,
      y: 30,
      fontSize: 28,
      fill: '#ff0000',
    };
    
    // Add a shadow-like effect by adding a background rect or just using text shadow if supported
    // For simplicity with the current CanvasElement type, we'll just add the text
    setCanvasElements(prev => [...prev, badge]);
    setSelectedId(id);
    setActiveTab('edit');
    
    setShowModal({
      title: 'Logo Added',
      message: 'The Red LIVE logo has been added to your editor. You can now move and resize it!',
      type: 'alert'
    });
  };

  const generateThumbnail = async () => {
    const modelInfo = availableModels.find(m => m.id === selectedModel);
    if (!modelInfo) return;

    const apiKey = getApiKey(selectedModel === 'imagen-4.0-generate-001' || selectedModel.startsWith('veo'));
    if (!apiKey) return;

    // Plan-based access control
    const planHierarchy = { 'Free': 0, 'Premium': 1, 'Max': 2 };
    const userPlanLevel = planHierarchy[currentPlan as keyof typeof planHierarchy] || 0;
    const requiredPlanLevel = planHierarchy[modelInfo.plan as keyof typeof planHierarchy] || 0;

    if (userPlanLevel < requiredPlanLevel) {
      setShowModal({
        title: 'Subscription Required',
        message: `The "${modelInfo.name}" model requires a ${modelInfo.plan} subscription. Upgrade now?`,
        type: 'confirm',
        onConfirm: () => {
          setShowModal(null);
          setShowPlans(true);
        }
      });
      return;
    }

    const isPremiumModel = selectedModel === 'imagen-4.0-generate-001' || selectedModel.startsWith('veo');
    
    if (!prompt.trim()) {
      setShowModal({
        title: 'Missing Prompt',
        message: 'Please enter a description for your thumbnail.',
        type: 'alert'
      });
      return;
    }
    if (!checkLimits(imageSize)) return;
    
    setLoading(true);
    setLoadingMessage('Generating...');
    try {
      // Artificial delay as requested
      if (selectedModel === 'gemini-2.5-flash-image') {
        setLoadingMessage('Processing...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        setLoadingMessage('Generating...');
      }

      const apiKey = getApiKey(isPremiumModel);
      
      const categoryPrompts: Record<string, string> = {
        'Minecraft': 'Minecraft style, blocky world, cinematic lighting, high resolution, 8k, detailed textures',
        'GTA V': 'GTA V loading screen style, digital art, high contrast, vibrant colors, cinematic action, rockstar games aesthetic',
        'Free Fire Max': 'Free Fire Max game style, mobile gaming aesthetic, heroic pose, high quality 3D render, vibrant battlefield',
        'PUBG': 'PUBG battlegrounds style, realistic military aesthetic, gritty atmosphere, cinematic battle royale, high detail',
        'Real Life': 'Realistic photography, hyper-realistic, 8k resolution, cinematic lighting, professional camera, sharp focus'
      };

      const finalPrompt = `${categoryPrompts[thumbnailCategory]}: ${prompt}`;

      const ai = new GoogleGenAI({ apiKey });
      const isImagen = selectedModel.startsWith('imagen');
      const isVideo = selectedModel.startsWith('veo');
      
      // Map premium and pro max to base model as requested
      const actualModelId = (selectedModel === 'gemini-2.5-flash-image-promax' || selectedModel === 'gemini-2.5-flash-image') 
        ? 'gemini-2.5-flash-image' 
        : selectedModel;
      console.log('Selected model:', selectedModel);
      console.log('Actual model ID:', actualModelId);

      const isPremiumKeyRequired = actualModelId === 'gemini-3.1-flash-image-preview' || actualModelId.startsWith('veo');

      if (isPremiumKeyRequired) {
        const win = window as any;
        if (win.aistudio && typeof win.aistudio.hasSelectedApiKey === 'function') {
          const hasKey = await win.aistudio.hasSelectedApiKey();
          if (!hasKey) {
            setShowModal({
              title: 'API Key Required',
              message: (
                <div className="space-y-3">
                  <p>This model requires a paid Gemini API key from a Google Cloud project.</p>
                  <p className="text-sm text-zinc-400">
                    Please select your key to continue. You can learn more about billing and setup at 
                    <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline ml-1">
                      ai.google.dev/gemini-api/docs/billing
                    </a>.
                  </p>
                </div>
              ) as any,
              type: 'confirm',
              onConfirm: async () => {
                await win.aistudio.openSelectKey();
                setShowModal(null);
                // Proceed with generation after opening the dialog (as per guidelines to mitigate race condition)
                generateThumbnail(); 
              }
            });
            return;
          }
        }
      }

      if (isVideo) {
        setIsGeneratingVideo(true);
        setVideoProgress('Gemini is enhancing your prompt...');
        try {
          // Use Gemini to enhance the prompt for better video results
          const enhancerResponse = await ai.models.generateContent({
            model: 'gemini-2.5-flash-preview',
            contents: [{ parts: [{ text: `Enhance this video generation prompt for a ${thumbnailCategory} thumbnail video: "${finalPrompt}". Make it cinematic, high-detail, and visually stunning. Return only the enhanced prompt text.` }] }],
          });
          const enhancedPrompt = enhancerResponse.text || finalPrompt;

          setVideoProgress('Gemini Video is crafting your cinematic masterpiece...');
          let operation = await ai.models.generateVideos({
            model: actualModelId,
            prompt: enhancedPrompt,
            config: {
              numberOfVideos: 1,
              resolution: actualModelId === 'veo-3.1-generate-preview' ? '1080p' : '720p',
              aspectRatio: (aspectRatio === '9:16' ? '9:16' : '16:9') as any
            }
          });

          while (!operation.done) {
            setVideoProgress('Gemini Video is crafting your cinematic masterpiece...');
            await new Promise(resolve => setTimeout(resolve, 10000));
            operation = await ai.operations.getVideosOperation({ operation: operation });
          }

          const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
          if (downloadLink) {
            const response = await fetch(downloadLink, {
              method: 'GET',
              headers: {
                'x-goog-api-key': apiKey,
              },
            });
            const blob = await response.blob();
            const videoUrl = URL.createObjectURL(blob);
            setGeneratedVideo(videoUrl);
            setGeneratedImage(null); // Clear image if video is generated
            addToHistory(videoUrl);
            await recordGeneration(imageSize);
          } else {
            throw new Error('Video generation completed but no download link was found.');
          }
        } finally {
          setIsGeneratingVideo(false);
          setVideoProgress('');
        }
      } else if (isImagen) {
        const response = await ai.models.generateImages({
          model: actualModelId,
          prompt: finalPrompt,
          config: {
            numberOfImages: 1,
            aspectRatio: aspectRatio as any,
            outputMimeType: 'image/png',
          },
        });
        
        if (!response.generatedImages || response.generatedImages.length === 0) {
          throw new Error('No image was generated by Imagen.');
        }

        const base64EncodeString: string = response.generatedImages[0].image.imageBytes;
        const imageUrl = `data:image/png;base64,${base64EncodeString}`;
        setGeneratedImage(imageUrl);
        addToHistory(imageUrl);
        await recordGeneration(imageSize);
      } else {
        const config: any = {
          imageConfig: {
            aspectRatio: aspectRatio as any,
          },
          systemInstruction: "You are an image generation model. Always generate an image based on the user's prompt, even if it contains typos or unrecognized words. Interpret unrecognized words as creative concepts or visual elements. Do not return text responses explaining typos; just generate the best possible image."
        };
        
        if (actualModelId === 'gemini-3.1-flash-image-preview' || actualModelId === 'gemini-3-pro-image-preview') {
          config.imageConfig.imageSize = (imageSize === '8K' ? '4K' : imageSize) as any;
        }

        const response = await ai.models.generateContent({
          model: actualModelId,
          contents: {
            parts: [{ text: finalPrompt }],
          },
          config,
        });

        if (!response.candidates?.[0]) {
          throw new Error('Nano Banana returned no candidates. This might be due to safety filters.');
        }

        const candidate = response.candidates[0];
        if (candidate.finishReason && candidate.finishReason !== 'STOP') {
          throw new Error(`Generation stopped early: ${candidate.finishReason}. Try a different prompt.`);
        }

        if (!candidate.content?.parts) {
          throw new Error('No content returned from Nano Banana.');
        }

        let foundImage = false;
        let textResponse = '';
        
        for (const part of candidate.content.parts) {
          if (part.inlineData) {
            const base64EncodeString: string = part.inlineData.data;
            const imageUrl = `data:image/png;base64,${base64EncodeString}`;
            setGeneratedImage(imageUrl);
            addToHistory(imageUrl);
            await recordGeneration(imageSize);
            foundImage = true;
            break;
          } else if (part.text) {
            textResponse += part.text;
          }
        }
        
        if (!foundImage) {
          if (textResponse) {
            throw new Error(`The AI refused to generate this image: "${textResponse.substring(0, 100)}${textResponse.length > 100 ? '...' : ''}". Try simplifying your prompt or selecting a more advanced model.`);
          }
          throw new Error('Nano Banana returned a response but no image data was found.');
        }
      }
    } catch (error: any) {
      console.error("Generation Error:", error);
      let errorMsg = error?.message || "";

      // Try to parse JSON error if message is a JSON string
      try {
        if (typeof errorMsg === 'string' && errorMsg.includes('{')) {
          const jsonStart = errorMsg.indexOf('{');
          const parsed = JSON.parse(errorMsg.substring(jsonStart));
          if (parsed.error?.message) errorMsg = parsed.error.message;
        }
      } catch (e) {}
      
      const isPermissionError = 
        error?.status === 403 || 
        error?.code === 403 || 
        errorMsg.includes('403') || 
        errorMsg.includes('PERMISSION_DENIED') || 
        errorMsg.toLowerCase().includes('permission') ||
        errorMsg.includes('caller does not have permission');

      const isQuotaError = 
        error?.status === 429 || 
        error?.code === 429 || 
        errorMsg.includes('429') || 
        errorMsg.includes('RESOURCE_EXHAUSTED') || 
        errorMsg.toLowerCase().includes('quota exceeded') ||
        errorMsg.toLowerCase().includes('rate limit');

      if (isQuotaError) {
        setShowModal({
          title: 'Quota Exceeded',
          message: (
            <div className="space-y-3">
              <p>You've reached the generation limit for the free tier of this model.</p>
              {currentPlan === 'Free' ? (
                <p className="text-sm text-zinc-400">
                  Upgrade to a <b>Premium</b> or <b>Max</b> plan to get more generations, or select your own paid Gemini API key to continue for free.
                </p>
              ) : (
                <p className="text-sm text-zinc-400">
                  The app's default API key has reached its limit. Please select your own paid Gemini API key to continue generating without interruptions.
                </p>
              )}
              <p className="text-xs text-zinc-500 italic">
                Learn more at 
                <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline ml-1">
                  ai.google.dev/gemini-api/docs/billing
                </a>.
              </p>
            </div>
          ) as any,
          type: 'confirm',
          onConfirm: async () => {
            const win = window as any;
            if (win.aistudio && typeof win.aistudio.openSelectKey === 'function') {
              await win.aistudio.openSelectKey();
              setShowModal(null);
              generateThumbnail(); 
            } else {
              setShowModal(null);
            }
          }
        });
      } else if (isPermissionError) {
        setShowModal({
          title: 'Permission Denied',
          message: `Permission Denied (403). The model "${selectedModel}" may require a paid API key or is restricted. Please ensure your GEMINI_API_KEY is correctly configured in the Secrets panel.`,
          type: 'alert'
        });
      } else if (errorMsg.includes('Requested entity was not found')) {
        setShowModal({
          title: 'Model Access Error',
          message: 'The selected API key does not have access to this model. Please check your API configuration.',
          type: 'alert'
        });
        setHasApiKey(false);
      } else if (errorMsg.includes('API_KEY_INVALID') || errorMsg.includes('API key not valid')) {
        setShowModal({
          title: 'Invalid API Key',
          message: 'Invalid API Key. Please check your configuration or reconnect.',
          type: 'alert'
        });
        setHasApiKey(false);
      } else if (errorMsg.includes('safety')) {
        setShowModal({
          title: 'Safety Filter',
          message: 'The prompt was flagged by safety filters. Please try a different description.',
          type: 'alert'
        });
      } else {
        setShowModal({
          title: 'Generation Failed',
          message: `${errorMsg || 'Unknown error'}. Please try a different model or check your API key.`,
          type: 'alert'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAICommandEdit = async () => {
    if (!editPrompt.trim()) {
      setShowModal({ title: 'Missing Command', message: 'Please enter a command for the AI to edit the thumbnail.', type: 'alert' });
      return;
    }

    const apiKey = getApiKey(true);
    if (!apiKey) return;

    setLoading(true);
    setLoadingMessage('Processing...');
    try {
      if (selectedModel === 'gemini-2.5-flash-image') {
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      setLoadingMessage('Generating...');
      
      if (!stageRef.current) throw new Error('Canvas not ready.');
      
      // Capture current canvas as image
      const canvas = stageRef.current.toCanvas();
      const base64Image = canvas.toDataURL('image/png').split(',')[1];

      const apiKey = getApiKey(true);
      const ai = new GoogleGenAI({ apiKey: apiKey! });
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Image,
                mimeType: 'image/png',
              },
            },
            {
              text: `Edit this Minecraft thumbnail according to this command: ${editPrompt}. 
              Maintain the Minecraft theme. 
              - If the user asks for a logo, add a custom, high-quality Minecraft-style logo. 
              - If they ask for emojis, add relevant Minecraft-style emojis or icons.
              - If they ask for text, render the text in a bold, Minecraft-themed font.
              Change the layout or background as requested. 
              Return ONLY the edited image.`,
            },
          ],
        },
      });

      if (!response.candidates?.[0]?.content?.parts) {
        throw new Error('AI returned no response parts.');
      }

      let foundImage = false;
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64 = `data:image/png;base64,${part.inlineData.data}`;
          setGeneratedImage(base64);
          addToHistory(base64);
          
          // Also update the canvas with the new background/image
          const newBg: CanvasElement = {
            id: 'bg-' + Date.now(),
            type: 'image',
            x: 0,
            y: 0,
            src: base64,
            width: 800,
            height: 450,
          };
          setCanvasElements([newBg]); // Replace all elements with the edited result
          setShowModal({ title: 'Edit Complete', message: 'The AI has updated your thumbnail based on your command.', type: 'alert' });
          foundImage = true;
          break;
        }
      }
      
      if (!foundImage) throw new Error('AI response did not contain an image.');

    } catch (error: any) {
      console.error("AI Edit Error:", error);
      let errorMsg = error?.message || "";
      try {
        if (typeof errorMsg === 'string' && errorMsg.includes('{')) {
          const jsonStart = errorMsg.indexOf('{');
          const parsed = JSON.parse(errorMsg.substring(jsonStart));
          if (parsed.error?.message) errorMsg = parsed.error.message;
        }
      } catch (e) {}

      const isPermissionError = 
        error?.status === 403 || 
        error?.code === 403 || 
        errorMsg.includes('403') || 
        errorMsg.includes('PERMISSION_DENIED') || 
        errorMsg.toLowerCase().includes('permission') ||
        errorMsg.includes('caller does not have permission');

      const isQuotaError = 
        error?.status === 429 || 
        error?.code === 429 || 
        errorMsg.includes('429') || 
        errorMsg.includes('RESOURCE_EXHAUSTED') || 
        errorMsg.toLowerCase().includes('quota exceeded') ||
        errorMsg.toLowerCase().includes('rate limit');

      if (isQuotaError) {
        setShowModal({
          title: 'Quota Exceeded',
          message: (
            <div className="space-y-3">
              <p>You've reached the generation limit for the free tier of this model.</p>
              {currentPlan === 'Free' ? (
                <p className="text-sm text-zinc-400">
                  Upgrade to a <b>Premium</b> or <b>Max</b> plan to get more generations, or select your own paid Gemini API key to continue for free.
                </p>
              ) : (
                <p className="text-sm text-zinc-400">
                  The app's default API key has reached its limit. Please select your own paid Gemini API key to continue generating without interruptions.
                </p>
              )}
              <p className="text-xs text-zinc-500 italic">
                Learn more at 
                <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-purple-400 hover:underline ml-1">
                  ai.google.dev/gemini-api/docs/billing
                </a>.
              </p>
            </div>
          ) as any,
          type: 'confirm',
          onConfirm: async () => {
            const win = window as any;
            if (win.aistudio && typeof win.aistudio.openSelectKey === 'function') {
              await win.aistudio.openSelectKey();
              setShowModal(null);
              handleAICommandEdit(); 
            } else {
              setShowModal(null);
            }
          }
        });
      } else if (isPermissionError) {
        setShowModal({
          title: 'Permission Denied',
          message: 'Permission Denied (403). AI Command Edit requires a paid API key or is restricted. Please check your API configuration.',
          type: 'alert'
        });
      } else {
        setShowModal({ title: 'Edit Failed', message: errorMsg || 'The AI could not process your edit command. Please try again.', type: 'alert' });
      }
    } finally {
      setLoading(false);
    }
  };

  const [transparencyColor, setTransparencyColor] = useState('#00ff00');
  const [colorTolerance, setColorTolerance] = useState(30);

  const removeColorFromImage = async () => {
    const targetId = selectedId || 'bg';
    const element = targetId === 'bg' ? { src: generatedImage } : canvasElements.find(el => el.id === targetId);
    
    if (!element || !element.src) {
      setShowModal({ title: 'No Image', message: 'Please select an image element first.', type: 'alert' });
      return;
    }

    setLoading(true);
    try {
      const img = new Image();
      img.crossOrigin = 'Anonymous';
      img.src = element.src;
      
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
      });

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Convert hex to RGB
      const r_target = parseInt(transparencyColor.slice(1, 3), 16);
      const g_target = parseInt(transparencyColor.slice(3, 5), 16);
      const b_target = parseInt(transparencyColor.slice(5, 7), 16);

      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];

        const distance = Math.sqrt(
          Math.pow(r - r_target, 2) +
          Math.pow(g - g_target, 2) +
          Math.pow(b - b_target, 2)
        );

        if (distance < colorTolerance) {
          data[i + 3] = 0; // Set alpha to 0
        }
      }

      ctx.putImageData(imageData, 0, 0);
      const newSrc = canvas.toDataURL('image/png');

      if (targetId === 'bg') {
        setGeneratedImage(newSrc);
      } else {
        setCanvasElements(prev => prev.map(el => el.id === targetId ? { ...el, src: newSrc } : el));
      }

      addToHistory(newSrc);
      setShowModal({ title: 'Color Removed', message: 'The selected color has been made transparent.', type: 'alert' });
    } catch (error: any) {
      console.error("Remove Color Error:", error);
      setShowModal({ title: 'Error', message: 'Failed to process image. Make sure it is a valid image.', type: 'alert' });
    } finally {
      setLoading(false);
    }
  };

  const pickColor = async () => {
    if (!(window as any).EyeDropper) {
      setShowModal({ title: 'Not Supported', message: 'Your browser does not support the EyeDropper API. Please enter the hex code manually.', type: 'alert' });
      return;
    }
    try {
      const eyeDropper = new (window as any).EyeDropper();
      const result = await eyeDropper.open();
      setTransparencyColor(result.sRGBHex);
    } catch (e) {
      console.log('EyeDropper cancelled or failed');
    }
  };

  const removeBackground = async () => {
    if (!generatedImage) {
      setShowModal({ title: 'No Image', message: 'Please generate or upload an image first.', type: 'alert' });
      return;
    }
    
    const apiKey = getApiKey(true);
    if (!apiKey) return;

    setLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey });
      
      // Get the image data
      let base64Image = '';
      if (generatedImage.startsWith('data:')) {
        base64Image = generatedImage.split(',')[1];
      } else {
        const imgResponse = await fetch(generatedImage);
        const blob = await imgResponse.blob();
        base64Image = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(blob);
        });
      }

      const aiResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            {
              inlineData: {
                data: base64Image,
                mimeType: 'image/png',
              },
            },
            {
              text: "Remove the background from this image. Return only the main subject. If possible, make the background transparent. If not, use a solid white background.",
            },
          ],
        },
      });

      if (!aiResponse.candidates?.[0]?.content?.parts) {
        throw new Error('AI returned no response parts.');
      }

      let found = false;
      for (const part of aiResponse.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64 = `data:image/png;base64,${part.inlineData.data}`;
          setGeneratedImage(base64);
          addToHistory(base64);
          
          // Update the background in the canvas if it exists
          setCanvasElements(prev => {
            const hasBg = prev.some(el => el.id === 'bg');
            if (hasBg) {
              return prev.map(el => el.id === 'bg' ? { ...el, src: base64 } : el);
            }
            return prev;
          });
          
          setShowModal({ title: 'Background Removed', message: 'The AI has processed your image to remove the background.', type: 'alert' });
          found = true;
          break;
        }
      }
      
      if (!found) throw new Error('AI response did not contain an image.');

    } catch (error: any) {
      console.error("Remove BG Error:", error);
      setShowModal({ title: 'Error', message: error.message || 'Failed to remove background.', type: 'alert' });
    } finally {
      setLoading(false);
    }
  };

  const editImage = async () => {
    if (!generatedImage || !file) return;
    
    setLoading(true);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onloadend = async () => {
        const base64Image = (reader.result as string).split(',')[1];
        const apiKey = getApiKey(false);
        const ai = new GoogleGenAI({ apiKey: apiKey! });
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: {
            parts: [
              {
                inlineData: {
                  data: base64Image,
                  mimeType: file.type,
                },
              },
              {
                text: `Edit this thumbnail: ${editPrompt}`,
              },
            ],
          },
        });
        for (const part of response.candidates[0].content.parts) {
          if (part.inlineData) {
            const base64EncodeString: string = part.inlineData.data;
            const imageUrl = `data:image/png;base64,${base64EncodeString}`;
            setGeneratedImage(imageUrl);
            addToHistory(imageUrl);
          }
        }
      };
    } catch (error) {
      console.error(error);
      toast.error('Edit failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (isHistoryPage) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8">
        <HistoryView 
          history={history} 
          setHistory={setHistory} 
          onClose={() => window.close()} 
          setGeneratedImage={setGeneratedImage}
          setGeneratedVideo={setGeneratedVideo}
          setShowModal={setShowModal}
        />
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500"></div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center p-4 relative overflow-hidden">
        {/* Netflix-style background */}
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black z-10" />
          <img 
            src="https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&q=80&w=2070" 
            className="w-full h-full object-cover opacity-50"
            alt="Background"
          />
        </div>

        <div className="relative z-20 bg-black/75 p-10 md:p-16 rounded-md w-full max-w-[450px] shadow-2xl backdrop-blur-sm">
          <div className="flex justify-center mb-10">
            <h1 className="text-4xl font-black text-emerald-600 tracking-tighter italic">MINETHUMB</h1>
          </div>
          
          <h1 className="text-3xl font-bold mb-8">
            {loginStep === 'login' ? 'Sign In' : 'Sign Up'}
          </h1>
          
          {authError && (
            <div className="mb-6 p-4 bg-[#e87c03] rounded text-white text-sm">
              {authError}
            </div>
          )}

          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div className="space-y-1">
              <input 
                type="email" 
                placeholder="Email or phone number" 
                value={email} 
                onChange={(e) => setEmail(e.target.value)} 
                className="w-full p-4 bg-[#333] rounded border-none focus:bg-[#454545] outline-none transition-colors text-white placeholder-zinc-500" 
              />
            </div>
            
            <div className="space-y-1">
              <input 
                type="password" 
                placeholder="Password" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                className="w-full p-4 bg-[#333] rounded border-none focus:bg-[#454545] outline-none transition-colors text-white placeholder-zinc-500" 
              />
            </div>
            
            {loginStep === 'register' && (
              <>
                <div className="space-y-1">
                  <input 
                    type="password" 
                    placeholder="Confirm Password" 
                    value={confirmPassword} 
                    onChange={(e) => setConfirmPassword(e.target.value)} 
                    className="w-full p-4 bg-[#333] rounded border-none focus:bg-[#454545] outline-none transition-colors text-white placeholder-zinc-500" 
                  />
                </div>
                <div className="space-y-1">
                  <input 
                    type="text" 
                    placeholder="Referral Code (Optional)" 
                    value={referralCode} 
                    onChange={(e) => setReferralCode(e.target.value)} 
                    className="w-full p-4 bg-[#333] rounded border-none focus:bg-[#454545] outline-none transition-colors text-white placeholder-zinc-500" 
                  />
                </div>
              </>
            )}

            <button 
              type="submit"
              disabled={isAuthProcessing}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 rounded font-bold transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center text-lg mt-4"
            >
              {isAuthProcessing ? (
                <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                loginStep === 'login' ? 'Sign In' : 'Sign Up'
              )}
            </button>
          </form>

          <div className="flex items-center justify-between mt-4 text-zinc-500 text-xs">
            <div className="flex items-center gap-1">
              <input type="checkbox" id="remember" className="accent-zinc-500" />
              <label htmlFor="remember">Remember me</label>
            </div>
            <button onClick={handleForgotPassword} className="hover:underline">Need help?</button>
          </div>

          <div className="mt-16 space-y-4">
            <button 
              onClick={handleGoogleLogin}
              disabled={isAuthProcessing}
              className="w-full py-2 flex items-center gap-2 text-zinc-400 hover:text-white transition-colors text-sm"
            >
              <img src="https://www.google.com/favicon.ico" alt="Google" className="w-4 h-4 grayscale opacity-70" />
              Login with Google
            </button>
            
            <p className="text-zinc-500 text-base">
              {loginStep === 'login' ? "New to MineThumb? " : "Already have an account? "}
              <button 
                onClick={() => {
                  setLoginStep(loginStep === 'login' ? 'register' : 'login');
                  setAuthError(null);
                }}
                className="text-white font-semibold hover:underline"
              >
                {loginStep === 'login' ? 'Sign up now' : 'Sign in now'}
              </button>
            </p>
            
            <p className="text-zinc-500 text-xs leading-tight">
              This page is protected by Google reCAPTCHA to ensure you're not a bot. <span className="text-blue-600 hover:underline cursor-pointer">Learn more.</span>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-4 md:p-8">
      {showSplash && (
        <motion.div 
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.8, delay: 2.2 }}
          onAnimationComplete={() => setShowSplash(false)}
          className="fixed inset-0 z-[1000] bg-black flex flex-col items-center justify-center"
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="text-center"
          >
            <motion.div
              animate={{ 
                rotateY: [0, 360],
                scale: [1, 1.1, 1]
              }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
              className="w-24 h-24 bg-emerald-600 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-[0_0_50px_rgba(16,185,129,0.3)]"
            >
              <div className="text-6xl">🥞</div>
            </motion.div>
            <h1 className="text-6xl font-black text-white tracking-tighter italic mb-2">
              MINE<span className="text-emerald-600">THUMB</span>
            </h1>
            <p className="text-zinc-500 uppercase tracking-[0.4em] text-[10px] font-bold mb-8">AI Powered Thumbnail Engine</p>
            <div className="flex items-center gap-2 justify-center">
              <motion.div 
                animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: 0 }}
                className="w-2 h-2 bg-emerald-500 rounded-full" 
              />
              <motion.div 
                animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: 0.2 }}
                className="w-2 h-2 bg-emerald-500 rounded-full" 
              />
              <motion.div 
                animate={{ scale: [1, 1.5, 1], opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1, repeat: Infinity, delay: 0.4 }}
                className="w-2 h-2 bg-emerald-500 rounded-full" 
              />
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* History Modal */}
      {showHistoryModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-zinc-950 border border-zinc-800 w-full max-w-6xl max-h-[90vh] rounded-3xl overflow-hidden shadow-2xl flex flex-col animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-600 rounded-lg shadow-lg shadow-emerald-600/20">
                  <History size={24} className="text-white" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight">Generation History</h1>
              </div>
              <button 
                onClick={() => setShowHistoryModal(false)}
                className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-400 hover:text-white"
              >
                <X size={24} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              <HistoryView 
                history={history} 
                setHistory={setHistory} 
                isModal 
                onClose={() => setShowHistoryModal(false)} 
                setGeneratedImage={setGeneratedImage}
                setGeneratedVideo={setGeneratedVideo}
                setShowModal={setShowModal}
              />
            </div>
          </div>
        </div>
      )}
      {/* Custom Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 w-full max-w-md shadow-2xl">
            <h3 className="text-xl font-bold mb-4">{showModal.title}</h3>
            <p className="text-zinc-400 mb-8 leading-relaxed">{showModal.message}</p>
            <div className="flex gap-4">
              {showModal.type === 'confirm' && (
                <button 
                  onClick={() => setShowModal(null)}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold transition-colors"
                >
                  Cancel
                </button>
              )}
              <button 
                onClick={() => {
                  if (showModal.onConfirm) {
                    showModal.onConfirm();
                  } else {
                    setShowModal(null);
                  }
                }}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold transition-colors"
              >
                {showModal.type === 'confirm' ? 'Confirm' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {(showPlans || showMandatoryUpgrade) && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[150] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 md:p-10 w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl relative">
            {!showMandatoryUpgrade && (
              <button onClick={() => setShowPlans(false)} className="absolute top-6 right-6 p-2 hover:bg-zinc-800 rounded-full transition-colors">✕</button>
            )}
            
            <div className="text-center mb-10">
              <h2 className="text-3xl md:text-4xl font-bold mb-3">
                {showMandatoryUpgrade ? 'Subscription Required' : 'Upgrade Your Experience'}
              </h2>
              <p className="text-zinc-400">
                {showMandatoryUpgrade 
                  ? 'Your subscription has ended or you are a new user. Please enter a redeem code to unlock full access.' 
                  : 'Unlock advanced AI models, higher resolutions, and exclusive features.'}
              </p>
            </div>

            {showMandatoryUpgrade ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
                {/* Benefits Section */}
                <div className="space-y-6">
                  <div className="p-6 bg-zinc-800/30 rounded-3xl border border-zinc-800">
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                      <Zap className="text-emerald-500" size={24} />
                      Premium Benefits
                    </h3>
                    <ul className="space-y-3">
                      {plans.find(p => p.name === 'Premium')?.features.map((f) => (
                        <li key={f} className="text-sm text-zinc-400 flex items-start gap-3">
                          <div className="mt-1.5 w-1.5 h-1.5 bg-emerald-500 rounded-full shrink-0" /> 
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  
                  <div className="p-6 bg-emerald-500/5 rounded-3xl border border-emerald-500/20">
                    <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                      <Crown className="text-amber-500" size={24} />
                      Max Features
                    </h3>
                    <ul className="space-y-3">
                      {plans.find(p => p.name === 'Max')?.features.map((f) => (
                        <li key={f} className="text-sm text-zinc-400 flex items-start gap-3">
                          <div className="mt-1.5 w-1.5 h-1.5 bg-amber-500 rounded-full shrink-0" /> 
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Redeem Section */}
                <div className="p-8 bg-zinc-800/50 rounded-3xl border border-zinc-800 text-center sticky top-0">
                  <div className="w-16 h-16 bg-emerald-600/20 text-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <Key size={32} />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Enter Redeem Code</h3>
                  <p className="text-sm text-zinc-500 mb-6">Enter your 128-character code or scan a QR code to activate your 30-day subscription.</p>
                  
                  {showQRScanner ? (
                    <div className="space-y-4">
                      <div className="relative aspect-square bg-black rounded-3xl border-2 border-emerald-500/30 overflow-hidden shadow-2xl">
                        <div id="qr-reader" className="w-full h-full" />
                        {qrScannerError && (
                          <div className="absolute inset-0 flex items-center justify-center p-6 text-center bg-zinc-950/90">
                            <div className="space-y-4">
                              <p className="text-red-400 text-sm font-bold">{qrScannerError}</p>
                              <button 
                                onClick={startScanner}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-xs font-bold uppercase"
                              >
                                Retry Camera
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-3">
                        <button 
                          onClick={stopScanner}
                          className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-bold text-sm transition-all"
                        >
                          Cancel
                        </button>
                        <label className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-500 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer text-white">
                          <ImageIcon size={18} /> From Gallery
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            onChange={handleGalleryScan}
                          />
                        </label>
                      </div>
                      <div id="qr-reader-hidden" className="hidden" />
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="relative">
                        <motion.input 
                          animate={redeemError ? { x: [-10, 10, -10, 10, 0] } : {}}
                          transition={{ duration: 0.4 }}
                          type="text"
                          placeholder="XXXX-XXXX-XXXX"
                          value={redeemCode}
                          onChange={(e) => {
                            setRedeemCode(e.target.value.toUpperCase());
                            setRedeemError(null);
                          }}
                          maxLength={128}
                          className={`w-full py-4 px-6 bg-zinc-900 border ${redeemError ? 'border-red-500' : 'border-zinc-700'} rounded-2xl text-center font-mono text-xl tracking-widest focus:border-emerald-500 outline-none transition-all`}
                        />
                        {redeemError && (
                          <p className="text-red-500 text-xs mt-2 font-medium">{redeemError}</p>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <button 
                          onClick={startScanner}
                          className="py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 border border-zinc-700"
                        >
                          <Camera size={18} /> Scan QR
                        </button>
                        <label className="py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 border border-zinc-700 cursor-pointer">
                          <ImageIcon size={18} /> Gallery
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            onChange={handleGalleryScan}
                          />
                        </label>
                      </div>

                      <button 
                        onClick={handleRedeem}
                        disabled={isRedeeming || !redeemCode}
                        className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded-2xl font-bold transition-all shadow-lg shadow-emerald-900/20 flex items-center justify-center gap-2"
                      >
                        {isRedeeming ? (
                          <>
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Processing...
                          </>
                        ) : 'Activate Access'}
                      </button>
                    </div>
                  )}
                  
                  <div className="mt-6 text-center space-y-4">
                    <p className="text-xs text-zinc-500">
                      Don't have a code? Contact support or check your email.
                    </p>
                    <button 
                      onClick={handleLogout}
                      className="text-xs font-bold text-red-500 hover:text-red-400 uppercase tracking-widest transition-colors"
                    >
                      Logout Account
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-10">
                {plans.filter(p => p.name !== 'Free').map((plan) => (
                  <div 
                    key={plan.name} 
                    onClick={() => setSelectedPlan(plan.name)}
                    className={`p-8 rounded-3xl border-2 flex flex-col transition-all cursor-pointer relative hover:scale-[1.02] ${selectedPlan === plan.name ? 'border-rose-500 bg-rose-500/10 ring-2 ring-rose-500/20' : 'border-zinc-800 bg-zinc-800/50'}`}
                  >
                    {currentPlan === plan.name && (
                      <div className="absolute top-4 right-4 px-3 py-1 bg-rose-500 text-white text-[10px] font-bold rounded-full uppercase tracking-tighter">
                        Current
                      </div>
                    )}
                    <div className={`w-14 h-14 ${plan.color} rounded-2xl flex items-center justify-center mb-6 shadow-lg`}>
                      {plan.icon}
                    </div>
                    <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                    <div className="flex items-baseline gap-1 mb-6">
                      <span className="text-3xl font-bold">{plan.price}</span>
                      <span className="text-zinc-500 text-sm">/ month</span>
                    </div>
                    <ul className="space-y-4 mb-10 flex-grow">
                      {plan.features.map((f) => (
                        <li key={f} className="text-sm text-zinc-300 flex items-start gap-3">
                          <div className="mt-1.5 w-1.5 h-1.5 bg-emerald-500 rounded-full shrink-0" /> 
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl text-center">
                      <p className="text-xs text-zinc-500 font-medium uppercase tracking-wider mb-2">Activation Required</p>
                      <p className="text-[10px] text-zinc-400 leading-tight">This plan can only be activated using a valid redeem code.</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!showMandatoryUpgrade && (
              <div className="p-6 bg-emerald-500/5 rounded-2xl border border-emerald-500/20 flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="text-center md:text-left">
                  <p className="font-bold text-lg mb-1 text-emerald-400">Have a redeem code?</p>
                  <p className="text-sm text-zinc-400">Enter your 69-character code to activate your subscription instantly.</p>
                </div>
                <button 
                  onClick={() => setShowRedeem(true)}
                  className="px-10 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold transition-all shadow-lg shadow-emerald-900/20 active:scale-95"
                >
                  Redeem Code
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showProfile && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 md:p-8 w-full max-w-md">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold">Profile Settings</h2>
              <button onClick={() => setShowProfile(false)} className="p-2 hover:bg-zinc-800 rounded-full">✕</button>
            </div>
            <div className="space-y-6">
              <div className="flex items-center gap-4 p-4 bg-zinc-800/50 rounded-2xl border border-zinc-800">
                <div className={`w-16 h-16 ${profileColor} rounded-full flex items-center justify-center text-2xl font-bold uppercase shadow-lg shadow-emerald-900/20`}>
                  {(user?.email || email || 'U')[0]}
                </div>
                <div>
                  <p className="font-bold text-lg">{user?.email || email || 'User'}</p>
                  <p className="text-xs text-zinc-500">Logged in via Email</p>
                </div>
              </div>

              <div className="p-5 bg-zinc-800/30 rounded-2xl border border-zinc-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Subscription Status</h4>
                  <button 
                    onClick={() => { setShowProfile(false); setShowPlans(true); }}
                    className="text-[10px] font-bold text-emerald-500 hover:underline uppercase"
                  >
                    Change Plan
                  </button>
                </div>
                
                <div className="flex justify-between items-center p-3 bg-zinc-900/50 rounded-xl border border-zinc-800">
                  <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-lg", plans.find(p => p.name === currentPlan)?.color)}>
                      {plans.find(p => p.name === currentPlan)?.icon}
                    </div>
                    <div>
                      <p className="text-sm font-bold">{currentPlan} Plan</p>
                      <p className="text-[10px] text-zinc-500 uppercase">Current Tier</p>
                    </div>
                  </div>
                  <div className="text-right">
                    {subscriptionEndDate ? (
                      (() => {
                        const diff = new Date(subscriptionEndDate).getTime() - currentTime.getTime();
                        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
                        
                        return (
                          <>
                            <p className="text-sm font-bold text-emerald-500 tabular-nums">
                              {diff > 0 ? `${days}d ${hours}h ${minutes}m ${seconds}s` : 'Expired'}
                            </p>
                            <p className="text-[10px] text-zinc-500 uppercase">Remaining</p>
                          </>
                        );
                      })()
                    ) : (
                      <>
                        <p className="text-sm font-bold text-zinc-400">Lifetime</p>
                        <p className="text-[10px] text-zinc-500 uppercase">No Expiry</p>
                      </>
                    )}
                  </div>
                </div>

                {subscriptionEndDate && (
                  <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                    <p className="text-[10px] text-emerald-500 font-bold uppercase mb-1">Subscription Period</p>
                    <p className="text-xs text-zinc-400">
                      Your {currentPlan} subscription is active until {new Date(subscriptionEndDate).toLocaleString()}.
                    </p>
                  </div>
                )}
              </div>

              <div className="p-5 bg-zinc-800/30 rounded-2xl border border-zinc-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Contact Information</h4>
                </div>
                <div className="flex justify-between items-center p-3 bg-zinc-900/50 rounded-xl border border-zinc-800">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-zinc-800">
                      <Mail size={18} className="text-emerald-500" />
                    </div>
                    <div>
                      <p className="text-sm font-bold">minethumb@gmail.com</p>
                      <p className="text-[10px] text-zinc-500 uppercase">Contact Email</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-zinc-800/30 rounded-2xl border border-zinc-800 space-y-3">
                <h4 className="text-xs font-bold uppercase text-zinc-500 tracking-wider">Today's Usage</h4>
                <div className="grid grid-cols-2 gap-4">
                  {Object.entries(dailyUsage).map(([key, val]) => {
                    if (key === 'total') return null;
                    const limit = (plans.find(p => p.name === currentPlan)?.limits as any)[key];
                    if (limit === 0 && currentPlan !== 'Max') return null;
                    return (
                      <div key={key} className="flex flex-col">
                        <span className="text-[10px] text-zinc-500 uppercase">{key}</span>
                        <span className="text-sm font-bold">{val} / {limit > 1000 ? '∞' : limit}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <button 
                onClick={() => { setShowProfile(false); setShowRedeem(true); }}
                className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold flex items-center justify-center gap-2 transition-colors"
              >
                <Zap size={18} /> Redeem Code
              </button>

                {/* Admin Section */}
                <div className="pt-4 border-t border-zinc-800">
                  {user?.email === 'indiafff568@gmail.com' && (
                    <div className="space-y-4">
                      <button 
                        onClick={() => setShowAdminPanel(true)}
                        className="w-full py-3 bg-emerald-600/10 hover:bg-emerald-600/20 rounded-xl text-xs font-bold uppercase tracking-widest text-emerald-500 transition-all flex items-center justify-center gap-2 border border-emerald-500/20"
                      >
                        <Lock size={14} /> Admin Panel
                      </button>

                      {showAdminPanel && (
                        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 md:p-8 bg-black/90 backdrop-blur-md animate-in fade-in duration-200">
                          <div className="bg-zinc-950 border border-emerald-500/30 w-full max-w-5xl max-h-[90vh] rounded-[2.5rem] overflow-hidden shadow-[0_0_50px_rgba(16,185,129,0.1)] flex flex-col animate-in zoom-in-95 duration-200">
                            <div className="p-8 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                              <div className="flex items-center gap-4">
                                <div className="p-3 bg-emerald-600 rounded-2xl shadow-lg shadow-emerald-600/20">
                                  <Lock size={28} className="text-white" />
                                </div>
                                <div>
                                  <h1 className="text-2xl font-black tracking-tighter italic text-white uppercase">Admin Control Center</h1>
                                  <p className="text-[10px] uppercase tracking-[0.3em] text-emerald-500 font-bold">System Administrator Access</p>
                                </div>
                              </div>
                              <button 
                                onClick={() => setShowAdminPanel(false)}
                                className="p-3 hover:bg-zinc-800 rounded-2xl transition-all text-zinc-400 hover:text-white hover:rotate-90 duration-300"
                              >
                                <X size={28} />
                              </button>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar space-y-12">
                              {/* Generator Section */}
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                                <div className="space-y-6">
                                  <div className="flex items-center gap-3 mb-2">
                                    <div className="w-1 h-6 bg-emerald-500 rounded-full" />
                                    <h5 className="text-xs font-black uppercase text-zinc-400 tracking-[0.2em]">Generate New Access Code</h5>
                                  </div>
                                  
                                  <div className="bg-zinc-900/50 p-6 rounded-3xl border border-zinc-800 space-y-6">
                                    <div className="space-y-3">
                                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Select Subscription Tier</label>
                                      <div className="flex gap-3">
                                        {['Premium', 'Max'].map((plan) => (
                                          <button 
                                            key={plan}
                                            onClick={() => setSelectedCodePlan(plan as any)}
                                            className={cn(
                                              "flex-1 py-4 rounded-2xl text-xs font-black uppercase tracking-widest border transition-all duration-300",
                                              selectedCodePlan === plan 
                                                ? "bg-emerald-600 border-emerald-500 text-white shadow-[0_10px_20px_rgba(16,185,129,0.2)] scale-[1.02]" 
                                                : "bg-zinc-800/50 border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
                                            )}
                                          >
                                            {plan}
                                          </button>
                                        ))}
                                      </div>
                                    </div>

                                    <button 
                                      onClick={generateRedeemCode}
                                      className="w-full py-5 bg-white text-black hover:bg-emerald-400 transition-all rounded-2xl font-black uppercase tracking-[0.15em] text-xs shadow-xl active:scale-95 flex items-center justify-center gap-2"
                                    >
                                      <Plus size={18} /> Generate {selectedCodePlan} Code
                                    </button>

                                    {generatedCode && (
                                      <div className="p-6 bg-black rounded-2xl border border-emerald-500/20 group relative overflow-hidden">
                                        <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500/50" />
                                        <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-widest mb-3">New Code Generated</p>
                                        <p className="font-mono text-sm break-all text-white selection:bg-emerald-500 selection:text-black leading-relaxed font-bold tracking-wider">{generatedCode}</p>
                                        <button 
                                          onClick={() => {
                                            navigator.clipboard.writeText(generatedCode);
                                            setShowModal({ title: 'Copied', message: 'Code copied to clipboard!', type: 'alert' });
                                          }}
                                          className="mt-4 w-full py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-colors flex items-center justify-center gap-2"
                                        >
                                          <Copy size={14} /> Copy to Clipboard
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="space-y-6">
                                  <div className="flex items-center gap-3 mb-2">
                                    <div className="w-1 h-6 bg-blue-500 rounded-full" />
                                    <h5 className="text-xs font-black uppercase text-zinc-400 tracking-[0.2em]">System Statistics</h5>
                                  </div>
                                  
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="bg-zinc-900/50 p-6 rounded-3xl border border-zinc-800">
                                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Active Users</p>
                                      <p className="text-3xl font-black text-white italic">1,284</p>
                                    </div>
                                    <div className="bg-zinc-900/50 p-6 rounded-3xl border border-zinc-800">
                                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Total Generations</p>
                                      <p className="text-3xl font-black text-white italic">42.5K</p>
                                    </div>
                                    <div className="bg-zinc-900/50 p-6 rounded-3xl border border-zinc-800">
                                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Server Load</p>
                                      <p className="text-3xl font-black text-emerald-500 italic">12%</p>
                                    </div>
                                    <div className="bg-zinc-900/50 p-6 rounded-3xl border border-zinc-800">
                                      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">Uptime</p>
                                      <p className="text-3xl font-black text-white italic">99.9%</p>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Management Section */}
                              <div className="space-y-6 pt-6 border-t border-zinc-800">
                                <div className="flex items-center gap-3 mb-2">
                                  <div className="w-1 h-6 bg-purple-500 rounded-full" />
                                  <h5 className="text-xs font-black uppercase text-zinc-400 tracking-[0.2em]">Manage Codes ({allRedeemCodes.length})</h5>
                                </div>
                                
                                <div className="bg-zinc-900/50 rounded-3xl border border-zinc-800 overflow-hidden">
                                  <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                                    {allRedeemCodes.length === 0 ? (
                                      <p className="text-xs text-zinc-600 italic text-center py-12">No codes found in database.</p>
                                    ) : (
                                      <table className="w-full text-left border-collapse">
                                        <thead className="sticky top-0 bg-zinc-900 z-10 border-b border-zinc-800">
                                          <tr>
                                            <th className="p-4 text-[10px] font-black uppercase text-zinc-500 tracking-widest">Code</th>
                                            <th className="p-4 text-[10px] font-black uppercase text-zinc-500 tracking-widest">Plan</th>
                                            <th className="p-4 text-[10px] font-black uppercase text-zinc-500 tracking-widest">Status</th>
                                            <th className="p-4 text-[10px] font-black uppercase text-zinc-500 tracking-widest text-right">Action</th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-800/50">
                                          {allRedeemCodes.map((code) => (
                                            <tr key={code.id} className="hover:bg-white/5 transition-colors">
                                              <td className="p-4 font-mono text-[10px] text-zinc-300">{code.code}</td>
                                              <td className="p-4">
                                                <span className={cn(
                                                  "px-2 py-1 rounded-md text-[9px] font-black uppercase tracking-tighter",
                                                  code.plan === 'Max' ? "bg-purple-500/20 text-purple-400" : "bg-blue-500/20 text-blue-400"
                                                )}>
                                                  {code.plan}
                                                </span>
                                              </td>
                                              <td className="p-4">
                                                <span className={cn(
                                                  "flex items-center gap-1.5 text-[9px] font-bold uppercase",
                                                  code.isUsed ? "text-red-400" : "text-emerald-400"
                                                )}>
                                                  <div className={cn("w-1.5 h-1.5 rounded-full", code.isUsed ? "bg-red-400" : "bg-emerald-400")} />
                                                  {code.isUsed ? 'Used' : 'Active'}
                                                </span>
                                              </td>
                                              <td className="p-4 text-right flex items-center justify-end gap-2">
                                                <button 
                                                  onClick={() => setShowQRModal(code.code)}
                                                  className="p-2 hover:bg-emerald-500/20 rounded-lg text-zinc-600 hover:text-emerald-500 transition-all"
                                                  title="Show QR Code"
                                                >
                                                  <QrCode size={14} />
                                                </button>
                                                <button 
                                                  onClick={() => deleteRedeemCode(code.id)}
                                                  className="p-2 hover:bg-red-500/20 rounded-lg text-zinc-600 hover:text-red-500 transition-all"
                                                >
                                                  <Trash2 size={14} />
                                                </button>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {showQRModal && (
                        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/95 backdrop-blur-xl animate-in fade-in duration-300">
                          <div className="bg-zinc-950 border border-emerald-500/30 p-10 rounded-[3rem] text-center space-y-8 max-w-sm w-full shadow-[0_0_100px_rgba(16,185,129,0.2)] animate-in zoom-in-95 duration-300">
                            <div className="flex justify-between items-center mb-2">
                              <h3 className="text-xl font-black italic uppercase tracking-tighter text-white">Redeem QR Code</h3>
                              <button onClick={() => setShowQRModal(null)} className="p-2 hover:bg-zinc-800 rounded-2xl transition-all">
                                <X size={24} className="text-zinc-500" />
                              </button>
                            </div>
                            <div className="bg-white p-6 rounded-[2rem] inline-block shadow-2xl">
                              <QRCodeCanvas 
                                value={showQRModal} 
                                size={200}
                                level="H"
                                includeMargin={true}
                              />
                            </div>
                            <div className="space-y-2">
                              <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.3em]">Redeem Code</p>
                              <p className="font-mono text-sm font-black text-emerald-500 break-all bg-emerald-500/5 py-3 px-4 rounded-2xl border border-emerald-500/10 tracking-widest">{showQRModal}</p>
                            </div>
                            <button 
                              onClick={() => {
                                navigator.clipboard.writeText(showQRModal);
                                toast.success("Code copied!");
                              }}
                              className="w-full py-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-2xl text-xs font-bold uppercase tracking-widest transition-all flex items-center justify-center gap-3"
                            >
                              <Copy size={16} /> Copy Code
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

              <button 
                onClick={handleLogout}
                className="w-full py-4 bg-red-900/20 text-red-500 hover:bg-red-900/30 rounded-xl font-bold transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {showRedeem && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 md:p-8 w-full max-w-md">
            <div className="flex justify-between items-center mb-8">
              <h2 className="text-2xl font-bold">Redeem Premium</h2>
              <button onClick={() => setShowRedeem(false)} className="p-2 hover:bg-zinc-800 rounded-full">✕</button>
            </div>
            <div className="space-y-6">
              <p className="text-zinc-400 text-sm">Enter your special redeem code or scan a QR code to upgrade your account instantly.</p>
              
              {showQRScanner ? (
                <div className="space-y-4">
                  <div className="relative aspect-square bg-black rounded-3xl border-2 border-emerald-500/30 overflow-hidden shadow-2xl">
                    <div id="qr-reader" className="w-full h-full" />
                    {qrScannerError && (
                      <div className="absolute inset-0 flex items-center justify-center p-6 text-center bg-zinc-950/90">
                        <div className="space-y-4">
                          <p className="text-red-400 text-sm font-bold">{qrScannerError}</p>
                          <button 
                            onClick={startScanner}
                            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-xs font-bold uppercase"
                          >
                            Retry Camera
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <button 
                      onClick={stopScanner}
                      className="flex-1 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-bold text-sm transition-all"
                    >
                      Cancel
                    </button>
                    <label className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-500 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer">
                      <ImageIcon size={18} /> From Gallery
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={handleGalleryScan}
                      />
                    </label>
                  </div>
                  <div id="qr-reader-hidden" className="hidden" />
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <input 
                      type="text" 
                      placeholder="ENTER REDEEM CODE" 
                      value={redeemCode}
                      onChange={(e) => setRedeemCode(e.target.value.toUpperCase())}
                      maxLength={128}
                      className="w-full p-4 bg-zinc-800 rounded-xl border border-zinc-700 focus:border-emerald-500 outline-none text-center text-xl tracking-widest font-mono"
                    />
                    <p className="text-[10px] text-zinc-500 text-center uppercase font-bold tracking-tighter">
                      {redeemCode.length} Characters
                    </p>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={startScanner}
                      className="py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 border border-zinc-700"
                    >
                      <Camera size={18} /> Scan QR
                    </button>
                    <label className="py-4 bg-zinc-800 hover:bg-zinc-700 rounded-2xl font-bold text-sm transition-all flex items-center justify-center gap-2 border border-zinc-700 cursor-pointer">
                      <ImageIcon size={18} /> Gallery
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={handleGalleryScan}
                      />
                    </label>
                  </div>

                  <button 
                    onClick={handleRedeem}
                    disabled={isRedeeming || !redeemCode}
                    className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isRedeeming ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Processing...
                      </>
                    ) : 'Redeem Now'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <header className="flex flex-col md:flex-row justify-between items-center gap-6 mb-8">
        <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tighter">MineThumb AI</h1>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowPlans(true)}
              className={`px-4 py-2 ${plans.find(p => p.name === currentPlan)?.color} rounded-xl flex items-center gap-2 text-sm font-bold shadow-lg shadow-black/20`}
            >
              {plans.find(p => p.name === currentPlan)?.icon}
              {currentPlan}
            </button>
            {currentPlan === 'Free' && (
              <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 px-3 py-2 rounded-xl">
                <Zap size={14} className="text-amber-500" />
                <span className="text-sm font-bold">{coins} Coins</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4 w-full md:w-auto justify-center md:justify-end">
          {currentPlan === 'Free' && (
            <button 
              onClick={watchAd}
              disabled={isWatchingAd}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl text-xs font-bold transition-colors flex items-center gap-2"
            >
              {isWatchingAd ? 'Watching...' : '+1 Coin (Watch Ad)'}
            </button>
          )}
          <button 
            onClick={openHistoryWindow}
            className="w-10 h-10 bg-zinc-800 hover:bg-zinc-700 rounded-full flex items-center justify-center border border-zinc-700 transition-colors"
            title="Photo History"
          >
            <History size={20} className="text-zinc-400" />
          </button>
          <button 
            onClick={() => setShowProfile(true)}
            className="w-10 h-10 bg-zinc-800 hover:bg-zinc-700 rounded-full flex items-center justify-center border border-zinc-700 transition-colors"
          >
            <div className={`w-6 h-6 ${profileColor} rounded-full flex items-center justify-center text-[10px] font-bold uppercase`}>
              {(user?.email || email || 'U')[0]}
            </div>
          </button>
        </div>
      </header>

      {/* Navigation Bar */}
      <nav className="flex flex-wrap justify-center gap-2 mb-8 bg-zinc-900/50 p-1.5 rounded-2xl border border-zinc-800 w-full md:w-fit mx-auto md:mx-0">
        <button 
          onClick={() => setActiveTab('thumbnail')}
          className={`px-3 md:px-6 py-2.5 rounded-xl text-xs md:text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'thumbnail' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/20' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
        >
          <Wand2 size={16} /> <span className="hidden sm:inline">Thumbnail Maker</span><span className="sm:hidden">Maker</span>
        </button>
        <button 
          onClick={() => setActiveTab('faceswap')}
          className={`px-3 md:px-6 py-2.5 rounded-xl text-xs md:text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'faceswap' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/20' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
        >
          <UserIcon size={16} /> <span className="hidden sm:inline">Face Swap Edit</span><span className="sm:hidden">Face Swap</span>
        </button>
        <button 
          onClick={() => {
            if (currentPlan === 'Free') {
              setShowModal({
                title: 'Premium Feature',
                message: 'Edit Thumbnail is a Premium feature. Please upgrade to use the advanced editor.',
                type: 'confirm',
                onConfirm: () => {
                  setShowModal(null);
                  setShowPlans(true);
                }
              });
              return;
            }
            setActiveTab('edit');
          }}
          className={`px-3 md:px-6 py-2.5 rounded-xl text-xs md:text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'edit' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/20' : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'}`}
        >
          <Move size={16} /> <span className="hidden sm:inline">Edit Thumbnail</span><span className="sm:hidden">Edit</span>
        </button>
        <button 
          onClick={openHistoryWindow}
          className="px-3 md:px-6 py-2.5 rounded-xl text-xs md:text-sm font-bold transition-all flex items-center gap-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
        >
          <History size={16} /> <span className="hidden sm:inline">History</span><span className="sm:hidden">History</span>
        </button>
      </nav>

      <main className="grid grid-cols-1 lg:grid-cols-2 gap-8 md:gap-12">
        {activeTab === 'edit' ? (
          <section className="lg:col-span-2 space-y-6">
            <div className="bg-zinc-900 p-6 md:p-8 rounded-3xl border border-zinc-800">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-8">
                <div>
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Move className="text-emerald-500" /> Advanced Editor
                  </h2>
                  <p className="text-zinc-500 text-sm">Move, resize, and customize your thumbnail elements.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {isLive && (
                    <div className="flex items-center gap-2 px-3 py-1 bg-red-600/20 border border-red-600/50 rounded-lg text-[10px] font-bold text-red-500 animate-pulse">
                      <div className="w-1.5 h-1.5 bg-red-600 rounded-full" /> <span className="hidden md:inline">LIVE</span>
                    </div>
                  )}
                  <button onClick={addLiveBadge} className="p-2 bg-red-600/10 hover:bg-red-600/20 border border-red-600/30 rounded-lg text-sm flex items-center gap-2 text-red-500" title="Add LIVE Logo">
                    <Video size={16} /> <span className="hidden md:inline">Add LIVE Logo</span>
                  </button>
                  <button onClick={addTextToCanvas} className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm flex items-center gap-2" title="Add Text">
                    <Type size={16} /> <span className="hidden md:inline">Add Text</span>
                  </button>
                  <button onClick={removeBackground} className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm flex items-center gap-2 text-emerald-500" title="Remove BG">
                    <Layers size={16} /> <span className="hidden md:inline">Remove BG</span>
                  </button>
                  <button onClick={handleDownload} className="p-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-sm flex items-center gap-2" title="Download">
                    <Download size={16} /> <span className="hidden md:inline">Download</span>
                  </button>
                  <button onClick={handleShare} className="p-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-sm flex items-center gap-2" title="Share">
                    <Share2 size={16} /> <span className="hidden md:inline">Share</span>
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 bg-black rounded-2xl overflow-hidden border border-zinc-800 relative aspect-video flex items-center justify-center">
                  {loading && (
                    <div className="absolute inset-0 z-10 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                      <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                      <p className="text-emerald-500 font-bold animate-pulse uppercase tracking-widest text-xs">
                        {isGeneratingVideo ? 'Gemini Video Processing...' : 'AI is crafting your elements...'}
                      </p>
                      {isGeneratingVideo && videoProgress && (
                        <p className="text-zinc-500 text-[10px] mt-2 uppercase tracking-tighter">{videoProgress}</p>
                      )}
                    </div>
                  )}
                  {generatedVideo ? (
                    <video 
                      src={generatedVideo} 
                      controls 
                      autoPlay 
                      loop 
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <Stage
                      width={aspectRatio === '9:16' ? 450 : 800}
                      height={aspectRatio === '9:16' ? 800 : 450}
                      ref={stageRef}
                      onMouseDown={(e) => {
                        const clickedOnEmpty = e.target === e.target.getStage();
                        if (clickedOnEmpty) setSelectedId(null);
                      }}
                    >
                      <Layer>
                        {/* Background */}
                        {generatedImage && (
                          <URLImage 
                            src={generatedImage} 
                            x={0} y={0} 
                            width={aspectRatio === '9:16' ? 450 : 800} height={aspectRatio === '9:16' ? 800 : 450} 
                            id="bg"
                            onSelect={() => setSelectedId('bg')}
                            isSelected={selectedId === 'bg'}
                            onChange={(newAttrs: any) => {}}
                            blurRadius={selectedId && selectedId !== 'bg' ? 4 : 0}
                          />
                        )}
                        {/* Dynamic Elements */}
                        {canvasElements.map((el) => (
                          el.type === 'image' ? (
                            <URLImage
                              key={el.id}
                              {...el}
                              isSelected={el.id === selectedId}
                              onSelect={() => setSelectedId(el.id)}
                              onChange={(newAttrs: any) => handleCanvasChange(el.id, newAttrs)}
                            />
                          ) : (
                            <EditableText
                              key={el.id}
                              {...el}
                              isSelected={el.id === selectedId}
                              onSelect={() => setSelectedId(el.id)}
                              onChange={(newAttrs: any) => handleCanvasChange(el.id, newAttrs)}
                            />
                          )
                        ))}
                      </Layer>
                    </Stage>
                  )}
                </div>

                <div className="space-y-6">
                  {selectedId && canvasElements.find(el => el.id === selectedId)?.type === 'text' && (
                    <div className="bg-zinc-800/50 p-6 rounded-2xl border border-zinc-800">
                      <h3 className="text-sm font-bold uppercase text-zinc-500 mb-4 flex items-center gap-2">
                        <Type size={14} /> Edit Selected Text
                      </h3>
                      <div className="space-y-4">
                        <div>
                          <label className="text-[10px] text-zinc-500 uppercase font-bold mb-1 block">Text Content</label>
                          <input 
                            type="text"
                            value={canvasElements.find(el => el.id === selectedId)?.text || ''}
                            onChange={(e) => handleCanvasChange(selectedId, { text: e.target.value })}
                            className="w-full p-3 bg-zinc-900 rounded-xl border border-zinc-700 focus:border-emerald-500 outline-none text-sm"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="text-[10px] text-zinc-500 uppercase font-bold mb-1 block">Font Size</label>
                            <input 
                              type="number"
                              value={canvasElements.find(el => el.id === selectedId)?.fontSize || 40}
                              onChange={(e) => handleCanvasChange(selectedId, { fontSize: parseInt(e.target.value) })}
                              className="w-full p-3 bg-zinc-900 rounded-xl border border-zinc-700 focus:border-emerald-500 outline-none text-sm"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] text-zinc-500 uppercase font-bold mb-1 block">Color</label>
                            <input 
                              type="color"
                              value={canvasElements.find(el => el.id === selectedId)?.fill || '#ffffff'}
                              onChange={(e) => handleCanvasChange(selectedId, { fill: e.target.value })}
                              className="w-full h-11 bg-zinc-900 rounded-xl border border-zinc-700 focus:border-emerald-500 outline-none cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="bg-zinc-800/50 p-6 rounded-2xl border border-zinc-800">
                    <h3 className="text-sm font-bold uppercase text-zinc-500 mb-4 flex items-center gap-2">
                      <Pipette size={14} /> Color Transparency
                    </h3>
                    <div className="space-y-4">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] text-zinc-500 uppercase font-bold mb-1 block">Target Color</label>
                          <div className="flex gap-2">
                            <input 
                              type="color"
                              value={transparencyColor}
                              onChange={(e) => setTransparencyColor(e.target.value)}
                              className="w-12 h-11 bg-zinc-900 rounded-xl border border-zinc-700 focus:border-emerald-500 outline-none cursor-pointer"
                            />
                            <input 
                              type="text"
                              value={transparencyColor}
                              onChange={(e) => setTransparencyColor(e.target.value)}
                              className="flex-1 p-3 bg-zinc-900 rounded-xl border border-zinc-700 focus:border-emerald-500 outline-none text-sm font-mono"
                            />
                            <button 
                              onClick={pickColor}
                              className="p-3 bg-zinc-900 hover:bg-zinc-800 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white transition-colors"
                              title="Pick color from screen"
                            >
                              <Pipette size={18} />
                            </button>
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="flex justify-between mb-1">
                          <label className="text-[10px] text-zinc-500 uppercase font-bold block">Tolerance</label>
                          <span className="text-[10px] text-emerald-500 font-mono">{colorTolerance}</span>
                        </div>
                        <input 
                          type="range"
                          min="0"
                          max="200"
                          value={colorTolerance}
                          onChange={(e) => setColorTolerance(parseInt(e.target.value))}
                          className="w-full h-1.5 bg-zinc-900 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                        />
                      </div>
                      <button 
                        onClick={removeColorFromImage}
                        disabled={loading}
                        className="w-full py-3 bg-emerald-600/10 hover:bg-emerald-600/20 border border-emerald-600/30 text-emerald-500 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
                      >
                        {loading ? (
                          <div className="w-4 h-4 border-2 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                        ) : (
                          <Layers size={16} />
                        )}
                        Remove Color
                      </button>
                    </div>
                  </div>

                  <div className="bg-zinc-800/50 p-6 rounded-2xl border border-zinc-800">
                    <h3 className="text-sm font-bold uppercase text-zinc-500 mb-4 flex items-center gap-2">
                      <Wand2 size={14} /> AI Command Edit
                    </h3>
                    <textarea
                      value={editPrompt}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditPrompt(val);
                        const wordCount = val.trim().split(/\s+/).filter(w => w.length > 0).length;
                        if (wordCount >= 20 && currentPlan === 'Free') {
                          setShowPlans(true);
                        }
                      }}
                      placeholder="Enter command (e.g., 'Change background to a snowy mountain', 'Rearrange for VS layout')..."
                      className="w-full p-3 bg-zinc-900 rounded-xl border border-zinc-700 focus:border-emerald-500 outline-none text-sm mb-4"
                      rows={3}
                    />
                    <button 
                      onClick={handleAICommandEdit}
                      disabled={loading}
                      className="w-full py-3 bg-purple-600 hover:bg-purple-500 rounded-xl font-bold text-sm transition-all disabled:opacity-50 shadow-lg shadow-purple-900/20"
                    >
                      {loading ? loadingMessage : 'Apply AI Command'}
                    </button>
                    <p className="text-[10px] text-zinc-500 mt-2 italic">
                      This will re-render the entire thumbnail based on your command.
                    </p>
                  </div>

                  <div className="bg-zinc-800/50 p-6 rounded-2xl border border-zinc-800">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold uppercase text-zinc-500 flex items-center gap-2">
                        <Layout size={14} /> Custom Layouts
                      </h3>
                      <div className="flex gap-2">
                        <input 
                          type="file" 
                          accept=".json,image/png,image/jpeg,image/webp" 
                          className="hidden" 
                          ref={layoutFileInputRef}
                          onChange={handleUploadLayout}
                        />
                        <button 
                          onClick={() => layoutFileInputRef.current?.click()}
                          className="text-[10px] font-bold text-emerald-500 hover:text-emerald-400 uppercase flex items-center gap-1"
                        >
                          <Upload size={10} /> Upload
                        </button>
                        <button 
                          onClick={saveCurrentLayout}
                          className="text-[10px] font-bold text-emerald-500 hover:text-emerald-400 uppercase flex items-center gap-1"
                        >
                          <Plus size={10} /> Save
                        </button>
                      </div>
                    </div>
                    
                    <div className="mb-4 relative">
                      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                        <Search size={14} className="text-zinc-500" />
                      </div>
                      <input
                        type="text"
                        placeholder="Search layouts..."
                        value={layoutSearchQuery}
                        onChange={(e) => setLayoutSearchQuery(e.target.value)}
                        className="w-full bg-zinc-900 border border-zinc-700 rounded-xl py-2 pl-9 pr-3 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 transition-colors"
                      />
                    </div>

                    <div className="space-y-4 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
                      {/* Saved Layouts */}
                      {customLayouts.filter(l => l.name.toLowerCase().includes(layoutSearchQuery.toLowerCase())).length > 0 && (
                        <div>
                          <p className="text-[10px] text-zinc-600 uppercase font-bold mb-2">Your Saved Layouts</p>
                          <div className="grid grid-cols-1 gap-2">
                            {customLayouts.filter(l => l.name.toLowerCase().includes(layoutSearchQuery.toLowerCase())).map(layout => (
                              <div key={layout.id} className="group flex items-center gap-2">
                                <button 
                                  onClick={() => setCanvasElements(prev => [...prev, ...JSON.parse(JSON.stringify(layout.elements))])}
                                  className="flex-1 p-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-xl text-[10px] font-bold uppercase transition-colors text-left truncate"
                                >
                                  {layout.name}
                                </button>
                                <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button 
                                    onClick={() => renameLayout(layout.id)}
                                    className="p-2 text-zinc-600 hover:text-emerald-500 transition-colors"
                                    title="Rename"
                                  >
                                    <Type size={14} />
                                  </button>
                                  <button 
                                    onClick={() => {
                                      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(layout));
                                      const downloadAnchorNode = document.createElement('a');
                                      downloadAnchorNode.setAttribute("href", dataStr);
                                      downloadAnchorNode.setAttribute("download", layout.name + ".json");
                                      document.body.appendChild(downloadAnchorNode);
                                      downloadAnchorNode.click();
                                      downloadAnchorNode.remove();
                                    }}
                                    className="p-2 text-zinc-600 hover:text-blue-500 transition-colors"
                                    title="Export"
                                  >
                                    <Download size={14} />
                                  </button>
                                  <button 
                                    onClick={() => deleteLayout(layout.id)}
                                    className="p-2 text-zinc-600 hover:text-red-500 transition-colors"
                                    title="Delete"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Viral Layouts Grouped */}
                      {['Games', 'Other', 'Viral PNGs'].map(category => {
                        const filteredLayouts = viralLayouts.filter(l => l.category === category && l.name.toLowerCase().includes(layoutSearchQuery.toLowerCase()));
                        if (filteredLayouts.length === 0) return null;
                        return (
                          <div key={category} className="mt-4">
                            <p className="text-[10px] text-zinc-600 uppercase font-bold mb-2">{category} Templates</p>
                            <div className="grid grid-cols-2 gap-2">
                              {filteredLayouts.map(layout => (
                                <button 
                                  key={layout.id}
                                  onClick={() => setCanvasElements(prev => [...prev, ...JSON.parse(JSON.stringify(layout.elements))])}
                                  className="p-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 rounded-xl text-[10px] font-bold uppercase transition-colors text-left truncate"
                                  title={layout.name}
                                >
                                  {layout.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      
                      {customLayouts.length === 0 && viralLayouts.filter(l => l.name.toLowerCase().includes(layoutSearchQuery.toLowerCase())).length === 0 && (
                        <p className="text-[10px] text-zinc-600 italic text-center py-4">No layouts found.</p>
                      )}
                    </div>
                  </div>

                  <div className="bg-zinc-800/50 p-6 rounded-2xl border border-zinc-800">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-bold uppercase text-zinc-500">Layers</h3>
                      {canvasElements.length > 0 && (
                        <button 
                          onClick={() => setCanvasElements([])}
                          className="text-[10px] font-bold text-red-500 hover:text-red-400 uppercase flex items-center gap-1"
                        >
                          <Trash2 size={10} /> Clear All
                        </button>
                      )}
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                      {canvasElements.length === 0 && <p className="text-xs text-zinc-600 italic">No elements added yet.</p>}
                      {canvasElements.map((el) => (
                        <div 
                          key={el.id} 
                          onClick={() => setSelectedId(el.id)}
                          className={cn(
                            "p-2 rounded-lg border cursor-pointer flex items-center justify-between transition-colors",
                            selectedId === el.id ? "bg-emerald-500/10 border-emerald-500" : "bg-zinc-900 border-zinc-800 hover:bg-zinc-800"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {el.type === 'image' ? <ImageIcon size={14} /> : <Type size={14} />}
                            <span className="text-xs truncate max-w-[100px]">{el.type === 'image' ? 'Image' : el.text}</span>
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setCanvasElements(canvasElements.filter(item => item.id !== el.id));
                              if (selectedId === el.id) setSelectedId(null);
                            }}
                            className="text-zinc-600 hover:text-red-500"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : activeTab === 'thumbnail' ? (
          <section className="bg-zinc-900 p-6 md:p-8 rounded-3xl border border-zinc-800">
            <h2 className="text-xl md:text-2xl font-semibold mb-6 flex items-center gap-2">
              <Wand2 /> Generate Thumbnail
            </h2>

            <div className="space-y-3 mb-6">
              <label className="text-xs text-zinc-500 uppercase font-bold tracking-wider flex items-center gap-2">
                <Star size={14} className="text-amber-500" /> Select Category
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                {(['Minecraft', 'GTA V', 'Free Fire Max', 'PUBG', 'Real Life'] as const).map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setThumbnailCategory(cat)}
                    className={cn(
                      "py-2 px-3 rounded-xl text-[10px] font-bold uppercase transition-all border",
                      thumbnailCategory === cat 
                        ? "bg-emerald-600 border-emerald-500 text-white shadow-lg shadow-emerald-900/20" 
                        : "bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
                    )}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <textarea
              value={prompt}
              onChange={(e) => {
                const val = e.target.value;
                setPrompt(val);
                const wordCount = val.trim().split(/\s+/).filter(w => w.length > 0).length;
                if (wordCount >= 20 && currentPlan === 'Free') {
                  setShowPlans(true);
                }
              }}
              placeholder={`Describe your ${thumbnailCategory} thumbnail (e.g., 'A character exploring a new world')...`}
              className="w-full p-4 bg-zinc-800 rounded-xl mb-4 border border-zinc-700 focus:border-emerald-500 outline-none transition-colors"
              rows={4}
            />
            <div className="space-y-3 mb-6">
              <label className="text-xs text-zinc-500 uppercase font-bold tracking-wider flex items-center gap-2">
                <Layers size={14} /> AI Model Selection
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {availableModels.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      if (m.id === 'veo-3.1-fast-generate-preview') {
                        toast.error('Gemini Video is currently in development. Stay tuned!', {
                          description: 'This feature will be available in a future update.',
                          icon: <Zap className="text-amber-500" />,
                        });
                        return;
                      }
                      setSelectedModel(m.id);
                    }}
                    disabled={currentPlan === 'Free' && m.plan !== 'Free' && !hasApiKey}
                    className={cn(
                      "p-4 rounded-2xl border text-left transition-all relative overflow-hidden group",
                      selectedModel === m.id 
                        ? "border-emerald-500 bg-emerald-500/10 shadow-lg shadow-emerald-900/20" 
                        : "border-zinc-800 bg-zinc-800/50 hover:bg-zinc-800 hover:border-zinc-700",
                      currentPlan === 'Free' && m.plan !== 'Free' && !hasApiKey && "opacity-50 grayscale"
                    )}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="font-bold text-sm leading-tight">{m.name}</span>
                      {currentPlan === 'Free' && m.plan !== 'Free' && !hasApiKey ? (
                        <Lock size={12} className="text-zinc-500" />
                      ) : (
                        selectedModel === m.id && <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 line-clamp-1">{m.description}</p>
                    <div className={cn(
                      "absolute bottom-0 right-0 px-2 py-0.5 text-[8px] font-bold uppercase rounded-tl-lg",
                      m.plan === 'Free' ? "bg-zinc-700 text-zinc-300" : m.plan === 'Premium' ? "bg-amber-600 text-white" : "bg-purple-600 text-white"
                    )}>
                      {m.plan}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 mb-6">
              <div className="space-y-2">
                <label className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Aspect Ratio</label>
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="w-full p-3 bg-zinc-800 rounded-xl border border-zinc-700 outline-none">
                  <option value="16:9">16:9 (YouTube)</option>
                  <option value="9:16">9:16 (Shorts)</option>
                  <option value="1:1">1:1 (Square)</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Quality</label>
                <select value={imageSize} onChange={(e) => setImageSize(e.target.value)} className="w-full p-3 bg-zinc-800 rounded-xl border border-zinc-700 outline-none">
                  <option value="1K">1K (Standard)</option>
                  <option value="2K" disabled={currentPlan === 'Free'}>2K (Premium)</option>
                  <option value="4K" disabled={currentPlan === 'Free'}>4K (Premium+)</option>
                  <option value="8K" disabled={currentPlan !== 'Max'}>8K (Upscaled Max)</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-3 mb-6">
              <button 
                onClick={generateThumbnail}
                disabled={loading}
                className="w-full py-3 md:py-4 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold disabled:opacity-50 transition-all active:scale-[0.98] shadow-lg shadow-emerald-900/20"
              >
                {loading ? loadingMessage : 'Create Thumbnail'}
              </button>
            </div>
          </section>
        ) : (
          <section className="bg-zinc-900 p-6 md:p-8 rounded-3xl border border-zinc-800">
            <h2 className="text-xl md:text-2xl font-semibold mb-6 flex items-center gap-2">
              <UserIcon /> Face Swap Edit
            </h2>
            <p className="text-zinc-400 text-sm mb-6">Upload a base image and a face image to swap. Requires Premium or Max plan.</p>
            
            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Base Image (Minecraft Scene)</label>
                <input 
                  type="file" 
                  onChange={(e) => setFile(e.target.files?.[0] || null)} 
                  className="w-full text-sm text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-zinc-800 file:text-white hover:file:bg-zinc-700 cursor-pointer" 
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Face Image (Your Photo)</label>
                <input 
                  type="file" 
                  className="w-full text-sm text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-zinc-800 file:text-white hover:file:bg-zinc-700 cursor-pointer" 
                />
              </div>

              <textarea
                placeholder="Additional instructions (e.g., 'Make the face match the lighting of the scene')..."
                className="w-full p-4 bg-zinc-800 rounded-xl border border-zinc-700 focus:border-emerald-500 outline-none transition-colors"
                rows={2}
              />

              <button 
                onClick={() => setShowModal({ title: 'Face Swap', message: 'Face Swap is available for Premium/Max users. This uses advanced AI vision to blend faces.', type: 'alert' })}
                disabled={currentPlan === 'Free'}
                className="w-full py-3 md:py-4 bg-emerald-600 hover:bg-emerald-500 rounded-xl font-bold disabled:opacity-50 transition-all active:scale-[0.98]"
              >
                {currentPlan === 'Free' ? 'Upgrade to Face Swap' : 'Start Face Swap'}
              </button>
            </div>
          </section>
        )}

        <section className="bg-zinc-900 p-6 md:p-8 rounded-3xl border border-zinc-800">
          <h2 className="text-xl md:text-2xl font-semibold mb-6 flex items-center gap-2">
            <ImageIcon /> Preview & Edit
          </h2>
          <div className="aspect-video bg-zinc-950 rounded-2xl flex items-center justify-center border-2 border-dashed border-zinc-800 mb-6 overflow-hidden relative group">
            {generatedVideo ? (
              <div className="w-full h-full relative">
                <video 
                  src={generatedVideo} 
                  controls 
                  autoPlay 
                  loop 
                  className="w-full h-full object-contain"
                />
                <div className="absolute bottom-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = generatedVideo;
                      link.download = `videogenx-${Date.now()}.mp4`;
                      link.click();
                    }}
                    className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1.5 shadow-xl"
                  >
                    <Download size={12} /> Save Video
                  </button>
                </div>
              </div>
            ) : generatedImage ? (
              <>
                <img src={generatedImage} alt="Generated" className="w-full h-full object-contain" />
                <div className="absolute bottom-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => {
                      const link = document.createElement('a');
                      link.href = generatedImage;
                      link.download = `minethub-${Date.now()}.png`;
                      link.click();
                    }}
                    className="bg-zinc-800 hover:bg-zinc-700 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold flex items-center gap-1.5 shadow-xl"
                  >
                    <Download size={12} /> Save
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center space-y-4">
                {loading ? (
                  <div className="flex flex-col items-center gap-4">
                    <div className="relative">
                      <div className="w-20 h-20 border-4 border-emerald-500/10 border-t-emerald-500 rounded-full animate-spin" />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-12 h-12 border-4 border-blue-500/10 border-t-blue-500 rounded-full animate-spin-slow" />
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Zap size={24} className="text-amber-500 animate-pulse" />
                      </div>
                    </div>
                    <div className="space-y-1 text-center">
                      <p className="text-emerald-500 font-bold text-lg animate-pulse">
                        {isGeneratingVideo ? 'Gemini Video is crafting your video...' : `${loadingMessage}...`}
                      </p>
                      <p className="text-zinc-500 text-[10px] uppercase tracking-[0.3em]">
                        {isGeneratingVideo ? 'Processing Cinematic Frames' : 'Processing High-Quality Pixels'}
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <ImageIcon className="mx-auto text-zinc-700" size={48} />
                    <p className="text-zinc-600 text-sm">Your creation will appear here</p>
                  </>
                )}
              </div>
            )}
            
            {loading && generatedImage && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-10">
                <div className="flex flex-col items-center gap-4">
                  <div className="w-12 h-12 border-4 border-emerald-500/20 border-t-emerald-500 rounded-full animate-spin" />
                  <p className="text-white font-bold">Applying Edits...</p>
                </div>
              </div>
            )}
          </div>
          
          {generatedImage && !loading && (
            <div className="flex flex-wrap gap-3 mb-8">
              <button 
                onClick={() => {
                  const link = document.createElement('a');
                  link.href = generatedImage;
                  link.download = `minethumb-${Date.now()}.png`;
                  link.click();
                }}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-500 rounded-xl text-white font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
              >
                <Download size={18} />
                Download Thumbnail
              </button>
              <button 
                onClick={() => setGeneratedImage(null)}
                className="px-6 py-3 bg-zinc-800 hover:bg-red-600/20 hover:text-red-500 rounded-xl text-zinc-400 font-bold transition-all flex items-center justify-center gap-2 border border-zinc-700"
              >
                <Trash2 size={18} />
                Delete
              </button>
              <button 
                onClick={() => {
                  if (navigator.share) {
                    navigator.share({
                      title: 'My Minecraft Thumbnail',
                      text: 'Check out this thumbnail I made with MineThumb AI!',
                      url: window.location.href
                    }).catch(console.error);
                  } else {
                    navigator.clipboard.writeText(generatedImage);
                    toast.success('Image URL copied to clipboard!');
                  }
                }}
                className="px-6 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-zinc-400 font-bold transition-all flex items-center justify-center gap-2 border border-zinc-700"
              >
                <Share2 size={18} />
                Share
              </button>
            </div>
          )}
          
          {generatedImage && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-800"></div></div>
                <div className="relative flex justify-center text-xs uppercase"><span className="bg-zinc-900 px-2 text-zinc-500 font-bold">Advanced Editing</span></div>
              </div>
              
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs text-zinc-500 uppercase font-bold tracking-wider">Upload Face/Reference</label>
                  <input 
                    type="file" 
                    onChange={(e) => setFile(e.target.files?.[0] || null)} 
                    className="w-full text-sm text-zinc-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-emerald-600 file:text-white hover:file:bg-emerald-500 cursor-pointer" 
                  />
                </div>
                <textarea
                  value={editPrompt}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditPrompt(val);
                    const wordCount = val.trim().split(/\s+/).filter(w => w.length > 0).length;
                    if (wordCount >= 20 && currentPlan === 'Free') {
                      setShowPlans(true);
                    }
                  }}
                  placeholder="Describe the edit (e.g., 'Swap the player's face with the uploaded photo')..."
                  className="w-full p-4 bg-zinc-800 rounded-xl border border-zinc-700 focus:border-blue-500 outline-none transition-colors"
                  rows={2}
                />
                <button 
                  onClick={editImage}
                  disabled={loading || !hasApiKey || !file || currentPlan === 'Free'}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold disabled:opacity-50 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                >
                  {loading ? loadingMessage : currentPlan === 'Free' ? 'Upgrade to Edit' : 'Apply Advanced Edit'}
                </button>
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div className="mt-12 space-y-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-zinc-800"></div></div>
                <div className="relative flex justify-center text-xs uppercase">
                  <button 
                    onClick={openHistoryWindow}
                    className="bg-zinc-900 px-3 py-1 text-zinc-500 hover:text-emerald-500 font-bold flex items-center gap-2 transition-colors rounded-full border border-zinc-800 hover:border-emerald-500/30"
                  >
                    <History size={14} /> Recent Generations
                  </button>
                </div>
              </div>
              
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                {history.map((img, idx) => (
                  <div key={idx} className="group relative aspect-video bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800 hover:border-emerald-500/50 transition-all">
                    <img src={img} alt={`History ${idx}`} className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button 
                        onClick={() => {
                          const link = document.createElement('a');
                          link.href = img;
                          link.download = `minethumb-history-${idx}.png`;
                          link.click();
                        }}
                        className="p-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white"
                        title="Download"
                      >
                        <Download size={16} />
                      </button>
                      <button 
                        onClick={() => setHistory(prev => prev.filter((_, i) => i !== idx))}
                        className="p-2 bg-red-600 hover:bg-red-500 rounded-lg text-white"
                        title="Delete"
                      >
                        <Trash2 size={16} />
                      </button>
                      <button 
                        onClick={() => setGeneratedImage(img)}
                        className="p-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-white"
                        title="View"
                      >
                        <ImageIcon size={16} />
                      </button>
                    </div>
                    {/* Mobile indicators */}
                    <div className="absolute bottom-1 right-1 flex gap-1 md:hidden">
                       <div className="w-2 h-2 bg-emerald-500 rounded-full shadow-glow"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
