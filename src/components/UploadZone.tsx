import { X, Camera } from 'lucide-react';

interface UploadZoneProps {
  onClose: () => void;
}

export function UploadZone({ onClose }: UploadZoneProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-2xl font-bold text-gray-900">Capture Screenshots</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-8">
          <div className="flex flex-col items-center text-center gap-4">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
              <Camera className="w-8 h-8 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                Use the Capture Button
              </h3>
              <p className="text-gray-600 mb-4">
                Click the "Capture" button in the top right corner to take a screenshot.
              </p>
              <div className="bg-blue-50 rounded-lg p-4 space-y-2 text-sm text-gray-700">
                <p className="font-medium">Keyboard Shortcut:</p>
                <kbd className="px-3 py-2 bg-blue-600 text-white rounded font-mono text-base">
                  Ctrl + Shift + S
                </kbd>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
