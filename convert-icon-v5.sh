#!/bin/bash

# 1. Resize the current public/icon.png to remove whitespace and maximize size
python3 resize_icon.py

# 2. Create iconset directory
mkdir -p icon.iconset

# 3. Generate different sizes for macOS icon from the RESIZED PNG
sips -z 16 16     public/icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     public/icon.png --out icon.iconset/icon_16x16@2x.png
sips -z 32 32     public/icon.png --out icon.iconset/icon_32x32.png
sips -z 64 64     public/icon.png --out icon.iconset/icon_32x32@2x.png
sips -z 128 128   public/icon.png --out icon.iconset/icon_128x128.png
sips -z 256 256   public/icon.png --out icon.iconset/icon_128x128@2x.png
sips -z 256 256   public/icon.png --out icon.iconset/icon_256x256.png
sips -z 512 512   public/icon.png --out icon.iconset/icon_256x256@2x.png
sips -z 512 512   public/icon.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 public/icon.png --out icon.iconset/icon_512x512@2x.png

# 4. Convert to icns
iconutil -c icns icon.iconset -o public/icon.icns

# Clean up
rm -rf icon.iconset

echo "Icon resize and conversion v5 complete!"
