from PIL import Image
import os

def resize_icon():
    icon_path = 'public/icon.png'
    if not os.path.exists(icon_path):
        print(f"Error: {icon_path} not found")
        return

    img = Image.open(icon_path)
    img = img.convert("RGBA")
    
    # Get the bounding box of the non-transparent content
    bbox = img.getbbox()
    if not bbox:
        print("Error: Image is empty or fully transparent")
        return
        
    # Crop the image to the bounding box
    cropped = img.crop(bbox)
    
    # Create a new 1024x1024 transparent canvas
    canvas_size = (1024, 1024)
    new_img = Image.new("RGBA", canvas_size, (0, 0, 0, 0))
    
    # Apple Specs: 1024x1024 canvas, main art within 832x832 (approx 10% padding)
    target_size = 832
    
    width, height = cropped.size
    aspect_ratio = width / height
    
    if width > height:
        new_width = target_size
        new_height = int(target_size / aspect_ratio)
    else:
        new_height = target_size
        new_width = int(target_size * aspect_ratio)
        
    # Resize the cropped content
    resized_content = cropped.resize((new_width, new_height), Image.Resampling.LANCZOS)
    
    # Paste into center of canvas
    x = (canvas_size[0] - new_width) // 2
    y = (canvas_size[1] - new_height) // 2
    
    new_img.paste(resized_content, (x, y), resized_content)
    
    # Save back to icon.png
    new_img.save(icon_path)
    print(f"Successfully resized icon. Content size: {new_width}x{new_height} on 1024x1024 canvas.")

if __name__ == "__main__":
    resize_icon()
