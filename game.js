// Musical Marble Drop Physics Game
class MusicalMarbleDrop {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.engine = Matter.Engine.create();
        this.world = this.engine.world;
        
        this.gameObjects = [];
        this.generatedObjects = [];
        this.trails = [];
        this.marble = null;
        this.imageCache = new Map(); // Cache for loaded images
        this.pixelDataCache = new Map(); // Cache for per-object pixel data
        // Alpha-based collision settings
        this.alphaThreshold = 20; // pixels with alpha >= threshold are solid (ignore faint antialiasing)
        this.useAlphaForCollision = true; // prefer alpha channel when available
        this.treatWhiteAsTransparent = true; // treat pure white like transparency
        // Debug overlay
        this.showCollisionOverlay = false; // press 'V' to toggle
        this.showMaskPreview = false; // press 'M' to toggle alpha-mask preview
        this.forceCollisionMode = 'auto'; // 'auto' | 'alpha' | 'rgb' (press 'A'/'B')
        this.showCellDebug = false; // press 'G' to toggle grid cell debug
        this.lastCollisionGrid = null; // stores last built grid for banana
        
        // Audio
        this.audioInitialized = false;
        this.synth = null;
        
        this.isDragging = false;
        this.isRotating = false;
        this.dragTarget = null;
        this.dragOffset = { x: 0, y: 0 };
        
        this.setupCanvas();
        this.setupPhysics();
        this.loadImages();
        this.createInitialScene();
        this.setupEventListeners();
        this.setupPixelCollisionDetection();
        this.startGameLoop();
    }
    
    loadImages() {
        const imagesToLoad = [
            { name: 'banana', path: './images/banana.png' },
            { name: 'ribbon_cable', path: './images/ribbon_cable.png' }
        ];

        imagesToLoad.forEach(async (imageInfo) => {
            try {
                const processed = await this.loadAndProcessImage(imageInfo.name, imageInfo.path, 48);
                console.log(`✅ Loaded + processed image: ${imageInfo.name}`, processed.width, processed.height);
            } catch (e) {
                console.error(`❌ Failed to load/process image: ${imageInfo.path}`, e);
            }
        });
    }

    // Dynamically load an image and key out near-white to transparency; caches result
    loadAndProcessImage(name, url, tolerance = 48) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                const processedCanvas = this.keyWhiteToAlpha(img, { tolerance });
                this.imageCache.set(name, processedCanvas);
                resolve(processedCanvas);
            };
            img.onerror = (err) => reject(err);
            img.src = url;
        });
    }

    // Public API: dynamically add an image object at runtime
    // options: { x, y, scale=1, tolerance=48, isStatic=true }
    async addImageObject(name, url, options = {}) {
        const { x = this.canvas.width / 2, y = this.canvas.height / 2, scale = 1, tolerance = 48, isStatic = true } = options;
        const imgCanvas = await this.loadAndProcessImage(name, url, tolerance);
        const width = imgCanvas.width * scale;
        const height = imgCanvas.height * scale;

        const obj = {
            text: name.toUpperCase(),
            x,
            y,
            image: imgCanvas,
            imageScale: scale,
            rotation: 0,
            isDraggable: true,
            isImage: true,
            width,
            height
        };

        let body;
        try {
            // Create and position a pixel-accurate compound body
            body = this.createAndPositionImageBody(imgCanvas, x, y, width, height, 0);
        } catch (e) {
            console.error('Failed to create accurate body for image, falling back to rectangle', e);
            body = Matter.Bodies.rectangle(x, y, width, height, {
                isStatic: isStatic,
                restitution: 0.4,
                friction: 0.6
            });
        }

        // Respect isStatic option
        Matter.Body.setStatic(body, isStatic);

        obj.body = body;
        body.gameObject = obj;
        this.gameObjects.push(obj);
        Matter.World.add(this.world, body);

        return obj;
    }

    // Convert near-white pixels to transparent alpha on a canvas and return the canvas
    // options: { tolerance: number (0-255) }
    keyWhiteToAlpha(image, options = {}) {
        const tolerance = Math.max(0, Math.min(255, options.tolerance ?? 48));
        const w = image.width;
        const h = image.height;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = w;
        canvas.height = h;

        ctx.drawImage(image, 0, 0, w, h);
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const thr = 255 - tolerance;

        // Sample background color from 4 corners to also key non-white uniform backgrounds
        const corner = (x, y) => {
            const idx = (y * w + x) * 4;
            return [data[idx], data[idx + 1], data[idx + 2]];
        };
        const c1 = corner(0, 0);
        const c2 = corner(w - 1, 0);
        const c3 = corner(0, h - 1);
        const c4 = corner(w - 1, h - 1);
        const bgR = Math.round((c1[0] + c2[0] + c3[0] + c4[0]) / 4);
        const bgG = Math.round((c1[1] + c2[1] + c3[1] + c4[1]) / 4);
        const bgB = Math.round((c1[2] + c2[2] + c3[2] + c4[2]) / 4);
        const bgBrightness = (bgR + bgG + bgB) / 3;
        const colorTol = Math.max(20, Math.floor(tolerance * 1.25));

        for (let i = 0; i < data.length; i += 4) {
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            // If pixel is close to pure white, make it transparent
            let makeTransparent = (r >= thr && g >= thr && b >= thr);

            // Also remove pixels that are close to the sampled background color
            if (!makeTransparent) {
                const dr = r - bgR, dg = g - bgG, db = b - bgB;
                const dist = Math.sqrt(dr * dr + dg * dg + db * db);
                const brightness = (r + g + b) / 3;
                if (dist < colorTol && Math.abs(brightness - bgBrightness) < 30) {
                    makeTransparent = true;
                }
            }

            if (makeTransparent) {
                data[i + 3] = 0; // alpha
            }
        }

        // Flood-fill from borders to remove any connected background-like regions
        const inBounds = (x, y) => x >= 0 && y >= 0 && x < w && y < h;
        const idxAt = (x, y) => (y * w + x) * 4;
        const isBackgroundLike = (x, y) => {
            const i = idxAt(x, y);
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            if (a === 0) return true; // already cleared
            const maxC = Math.max(r, g, b);
            const minC = Math.min(r, g, b);
            const brightness = (r + g + b) / 3;
            const chroma = maxC - minC;
            const nearWhite = brightness > 240 && chroma < 25; // more permissive
            const dr = r - bgR, dg = g - bgG, db = b - bgB;
            const dist = Math.sqrt(dr * dr + dg * dg + db * db);
            return nearWhite || dist < colorTol;
        };

        const q = [];
        const visited = new Uint8Array(w * h);
        // Seed queue with border pixels
        for (let x = 0; x < w; x++) {
            q.push([x, 0]);
            q.push([x, h - 1]);
        }
        for (let y = 0; y < h; y++) {
            q.push([0, y]);
            q.push([w - 1, y]);
        }
        while (q.length) {
            const [x, y] = q.pop();
            const vi = y * w + x;
            if (!inBounds(x, y) || visited[vi]) continue;
            visited[vi] = 1;
            if (isBackgroundLike(x, y)) {
                // clear and propagate
                data[idxAt(x, y) + 3] = 0;
                q.push([x + 1, y]);
                q.push([x - 1, y]);
                q.push([x, y + 1]);
                q.push([x, y - 1]);
            }
        }

        ctx.putImageData(imgData, 0, 0);
        return canvas;
    }
    
    init() {
        this.setupCanvas();
        this.setupPhysics();
        this.createInitialScene();
        this.setupEventListeners();
        this.startGameLoop();
        
        document.getElementById('status').textContent = 'Game loaded! Click to start audio.';
    }
    
    setupCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
        
        window.addEventListener('resize', () => {
            this.canvas.width = window.innerWidth;
            this.canvas.height = window.innerHeight;
        });
    }
    
    setupPhysics() {
        // Set gravity
        this.engine.world.gravity.y = 0.8;
        
        // Create boundaries (invisible walls) - no bottom wall so marble can fall through
        const boundaries = [
            // Left
            Matter.Bodies.rectangle(-50, this.canvas.height / 2, 100, this.canvas.height, { isStatic: true }),
            // Right  
            Matter.Bodies.rectangle(this.canvas.width + 50, this.canvas.height / 2, 100, this.canvas.height, { isStatic: true })
        ];
        
        Matter.World.add(this.world, boundaries);
    }
    
    createInitialScene() {
        // Create "MAKING" text
        const makingObj = this.createTextObject("MAKING", this.canvas.width * 0.3, this.canvas.height * 0.4, '#FF6B6B');
        makingObj.isDraggable = true; // Ensure it's draggable
        
        // Create "STUFF" text  
        const stuffObj = this.createTextObject("STUFF", this.canvas.width * 0.7, this.canvas.height * 0.6, '#4ECDC4');
        stuffObj.isDraggable = true; // Ensure it's draggable
        
        // Create the cup at bottom right
        this.createCup(this.canvas.width * 0.8, this.canvas.height * 0.9);
        
        // Create default banana object
        this.createDefaultBanana();
        this.createRibbonCable();
        
        // Spawn first marble
        this.spawnMarble();
    }
    
    createTextObject(text, x, y, color) {
        // Set font to measure text accurately
        this.ctx.font = '48px Arial';
        const textMetrics = this.ctx.measureText(text);
        const textWidth = textMetrics.width;
        
        const textObj = {
            text: text,
            x: x,
            y: y,
            color: color,
            fontSize: 48,
            rotation: 0,
            isDraggable: true,
            isText: true,
            width: textWidth + 20, // Add padding for better hitbox
            height: 60 // Slightly larger height for better hitbox
        };
        
        // Create physics body for text (static so it doesn't fall due to gravity)
        // Create physics body using traced vertices for pixel-perfect collision
        const vertices = this.traceTextVertices(text, textObj.fontSize);
        console.log(`Text "${text}" vertices:`, vertices.length, vertices);
        
        const body = vertices.length >= 3 
            ? Matter.Bodies.fromVertices(x, y, [vertices], {
                isStatic: true,
                restitution: 0.4,
                friction: 0.6
            })
            : Matter.Bodies.rectangle(x, y, textObj.width, textObj.height, {
                isStatic: true,
                restitution: 0.4,
                friction: 0.6
            });
        
        console.log(`Text "${text}" body type:`, vertices.length >= 3 ? 'fromVertices' : 'rectangle');
        
        textObj.body = body;
        body.gameObject = textObj;
        
        this.gameObjects.push(textObj);
        Matter.World.add(this.world, body);
        
        return textObj;
    }
    
    createDefaultBanana() {
        console.log('🍌 createDefaultBanana called');
        console.log('🖼️ Image cache contents:', Array.from(this.imageCache.keys()));
        
        // Wait for image to load before creating banana
        if (this.imageCache.has('banana')) {
            console.log('✅ Banana image found in cache');
            const img = this.imageCache.get('banana');
            const scale = 0.3;
            const x = this.canvas.width * 0.5;
            const y = this.canvas.height * 0.3;
            
            const obj = {
                text: 'BANANA',
                x: x,
                y: y,
                image: img,
                imageScale: scale,
                rotation: 0,
                isDraggable: true,
                isImage: true,
                width: img.width * scale,
                height: img.height * scale,
                kind: 'banana'
            };
            
            // Create multiple physics bodies to represent banana shape accurately
            let body;
            try {
                body = this.createAndPositionImageBody(img, x, y, obj.width, obj.height, 0);
                console.log(`✅ Created accurate banana body`);
            } catch (error) {
                console.error('❌ Failed to create accurate banana body:', error);
                // Fallback to simple rectangle
                body = Matter.Bodies.rectangle(x, y, obj.width, obj.height, {
                    isStatic: true,
                    restitution: 0.4,
                    friction: 0.6
                });
                console.log('🔄 Using fallback rectangle body');
            }
            
            obj.body = body;
            body.gameObject = obj;
            
            this.gameObjects.push(obj);
            Matter.World.add(this.world, body);
            console.log(`🎯 Banana added to gameObjects. Total objects: ${this.gameObjects.length}`);
            this.bananaObj = obj;
        } else {
            console.log('❌ Banana image not found in cache, retrying...');
            // Retry after a short delay if image not loaded yet
            setTimeout(() => this.createDefaultBanana(), 100);
        }
    }
    
    createBananaCompoundBody(x, y, width, height) {
        // Create a compound body that better represents the banana shape
        // Use multiple rectangles to approximate the curved banana outline
        
        const parts = [];
        const scale = 0.8; // Slightly smaller than visual for better gameplay
        
        // Outer curved back of banana (top arc)
        const backWidth = width * 0.8;
        const backHeight = height * 0.3;
        const backBody = Matter.Bodies.rectangle(
            x, 
            y - height * 0.2, 
            backWidth, 
            backHeight, 
            { isStatic: true }
        );
        parts.push(backBody);
        
        // Left side of banana
        const leftWidth = width * 0.25;
        const leftHeight = height * 0.6;
        const leftBody = Matter.Bodies.rectangle(
            x - width * 0.3, 
            y, 
            leftWidth, 
            leftHeight, 
            { isStatic: true }
        );
        parts.push(leftBody);
        
        // Right side of banana  
        const rightWidth = width * 0.25;
        const rightHeight = height * 0.6;
        const rightBody = Matter.Bodies.rectangle(
            x + width * 0.3, 
            y, 
            rightWidth, 
            rightHeight, 
            { isStatic: true }
        );
        parts.push(rightBody);
        
        // Bottom curve
        const bottomWidth = width * 0.6;
        const bottomHeight = height * 0.25;
        const bottomBody = Matter.Bodies.rectangle(
            x, 
            y + height * 0.25, 
            bottomWidth, 
            bottomHeight, 
            { isStatic: true }
        );
        parts.push(bottomBody);

        const compoundBody = Matter.Body.create({
            parts: parts,
            isStatic: true
        });

        return compoundBody;
    }
    
    createAccurateImageBody(img, width, height) {
        // This function creates the body centered at the origin (0,0)
        // The caller is responsible for positioning and rotating it correctly.
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');

        // Ensure integer pixel dimensions for canvas and indexing
        const W = Math.max(1, Math.round(width));
        const H = Math.max(1, Math.round(height));
        tempCanvas.width = W;
        tempCanvas.height = H;

        // Draw the scaled image
        tempCtx.drawImage(img, 0, 0, W, H);
        const imageData = tempCtx.getImageData(0, 0, W, H);

        // Decide detection mode: prefer alpha when using our processed canvas
        const isProcessedCanvas = (img instanceof HTMLCanvasElement);
        const hasTransparency = this.detectTransparency(imageData);
        let useAlpha = this.useAlphaForCollision && (isProcessedCanvas || hasTransparency);
        if (this.forceCollisionMode === 'alpha') useAlpha = true;
        if (this.forceCollisionMode === 'rgb') useAlpha = false;

        // Create a grid of small rectangles covering solid areas
        const parts = [];
        const gridSize = 4; // smaller grid for a tighter outline (higher fidelity)
        const cellRecords = [];

        for (let gy = 0; gy < imageData.height; gy += gridSize) {
            for (let gx = 0; gx < imageData.width; gx += gridSize) {
                let hasSolid = false;
                let solidCount = 0;

                for (let py = gy; py < Math.min(gy + gridSize, imageData.height); py++) {
                    for (let px = gx; px < Math.min(gx + gridSize, imageData.width); px++) {
                        const solid = this.isNonWhitePixel(imageData, px, py, imageData.width);
                        if (solid) {
                            solidCount++;
                            hasSolid = true;
                        }
                    }
                }

                const totalPx = (Math.min(gy + gridSize, imageData.height) - gy) * (Math.min(gx + gridSize, imageData.width) - gx);
                const ratio = totalPx > 0 ? (solidCount / totalPx) : 0;
                const include = hasSolid && ratio > 0.70;
                cellRecords.push({ gx, gy, ratio, include });

                if (include) {
                    // Create parts relative to origin
                    const rectX = gx - (imageData.width / 2) + gridSize / 2;
                    const rectY = gy - (imageData.height / 2) + gridSize / 2;
                    const rect = Matter.Bodies.rectangle(rectX, rectY, gridSize, gridSize, { isStatic: true });
                    parts.push(rect);
                }
            }
        }

        // For debugging, store the grid relative to the last object's center
        this.lastCollisionGrid = {
            imageW: imageData.width, imageH: imageData.height,
            gridSize, useAlpha, cells: cellRecords
        };

        console.log(`🔧 Created ${parts.length} collision rectangles for the image`);

        if (parts.length === 0) {
            console.warn('No solid parts found for image body, creating fallback rectangle.');
            return Matter.Bodies.rectangle(0, 0, width, height, { isStatic: true });
        }

        // To correctly center the compound body, we must calculate the geometric center of all its parts
        // and then translate all parts by the negative of that center.
        let totalX = 0;
        let totalY = 0;
        parts.forEach(part => {
            totalX += part.position.x;
            totalY += part.position.y;
        });

        const geometricCenter = {
            x: totalX / parts.length,
            y: totalY / parts.length
        };

        parts.forEach(part => {
            Matter.Body.setPosition(part, {
                x: part.position.x - geometricCenter.x,
                y: part.position.y - geometricCenter.y
            });
        });



        const compoundBody = Matter.Body.create({
            parts: parts,
            isStatic: true,
            restitution: 0.4,
            friction: 0.6
        });

        // Capture how much Matter placed the COM away from our origin
        const comShift = compoundBody && compoundBody.position ? { x: compoundBody.position.x, y: compoundBody.position.y } : { x: 0, y: 0 };

        // Normalize COM to origin (so rotations are around COM)
        if (compoundBody && compoundBody.position) {
            Matter.Body.translate(compoundBody, { x: -comShift.x, y: -comShift.y });
        }

        // Store render offset to keep the image aligned with the shifted parts
        // We already normalized COM to (0,0); only compensate for our -geometricCenter shift applied to parts
        compoundBody.renderOffset = { x: geometricCenter.x, y: geometricCenter.y };

        return compoundBody;
    }

    detectTransparency(imageData) {
        const data = imageData.data;
        for (let i = 3; i < data.length; i += 4) {
            if (data[i] < 255) return true; // Found a non-opaque pixel
        }
        return false;
    }


    createCup(x, y) {
        const cup = {
            x: x,
            y: y,
            width: 60,
            height: 80,
            color: '#FF4757',
            isCup: true,
            isStatic: true,
            isDraggable: false,
            text: 'CUP'
        };
        
        // Create cup physics body (sensor for detection)
        const body = Matter.Bodies.rectangle(x, y, cup.width, cup.height, {
            isStatic: true,
            isSensor: true
        });
        
        cup.body = body;
        body.gameObject = cup;
        
        this.gameObjects.push(cup);
        Matter.World.add(this.world, body);
        
        return cup;
    }
    
    setupPixelCollisionDetection() {
        // Create vertex cache for objects
        this.vertexCache = new Map();
        
        // Set up collision events for audio feedback
        Matter.Events.on(this.engine, 'collisionStart', (event) => {
            this.handleCollisionAudio(event.pairs);
        });
    }
    
    getPixelData(obj) {
        // Cache pixel data for performance
        const cacheKey = `${obj.text || 'image'}_${obj.rotation}`;
        if (this.pixelDataCache.has(cacheKey)) {
            return this.pixelDataCache.get(cacheKey);
        }
        
        // Create temporary canvas to extract pixel data
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        
        if (obj.isImage && obj.image) {
            tempCanvas.width = obj.width;
            tempCanvas.height = obj.height;
            tempCtx.save();
            tempCtx.translate(obj.width / 2, obj.height / 2);
            tempCtx.rotate(obj.rotation);
            const off = (obj.body && obj.body.renderOffset) ? obj.body.renderOffset : { x: 0, y: 0 };
            tempCtx.drawImage(obj.image, -obj.width / 2 - off.x, -obj.height / 2 - off.y, obj.width, obj.height);
            tempCtx.restore();
        } else if (obj.isText) {
            tempCanvas.width = obj.width;
            tempCanvas.height = obj.height;
            tempCtx.save();
            tempCtx.translate(obj.width / 2, obj.height / 2);
            tempCtx.rotate(obj.rotation);
            tempCtx.fillStyle = obj.color;
            tempCtx.font = `bold ${obj.fontSize}px Arial`;
            tempCtx.textAlign = 'center';
            tempCtx.textBaseline = 'middle';
            tempCtx.fillText(obj.text, 0, 0);
            tempCtx.restore();
        }
        
        const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
        this.pixelDataCache.set(cacheKey, imageData);
        return imageData;
    }
    
    isNonWhitePixel(imageData, x, y, width, height) {
        if (x < 0 || y < 0 || x >= width || y >= height) return false;
        const index = (y * width + x) * 4;
        const a = imageData.data[index + 3];
        // Consider pixel solid if alpha is above a threshold
        return a > this.alphaThreshold;
    }
    
    handleCollisionAudio(pairs) {
        for (const pair of pairs) {
            const { bodyA, bodyB } = pair;
            
            // Check if one of the bodies is the marble
            let marble, gameObject;
            if (bodyA === this.marble?.body) {
                marble = bodyA;
                gameObject = bodyB.gameObject;
            } else if (bodyB === this.marble?.body) {
                marble = bodyB;
                gameObject = bodyA.gameObject;
            }
            
            if (!marble || !gameObject || gameObject.isCup) continue;
            
            // Play audio for text objects
            if (gameObject.isText && this.audioContext) {
                this.playLetterSound(gameObject.text.charAt(0));
            }
            
            console.log('Collision with:', gameObject.text || 'image');
        }
    }
    
    traceTextVertices(text, fontSize) {
        // Create temporary canvas to trace text outline
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        
        // Set canvas size based on text
        tempCtx.font = `bold ${fontSize}px Arial`;
        const metrics = tempCtx.measureText(text);
        const width = metrics.width + 40;
        const height = fontSize + 20;
        
        tempCanvas.width = width;
        tempCanvas.height = height;
        
        // Draw text
        tempCtx.font = `bold ${fontSize}px Arial`;
        tempCtx.fillStyle = 'black';
        tempCtx.textAlign = 'center';
        tempCtx.textBaseline = 'middle';
        tempCtx.fillText(text, width / 2, height / 2);
        
        // Trace the outline
        return this.traceVerticesFromCanvas(tempCanvas);
    }
    
    traceImageVertices(image, scale) {
        // Create temporary canvas to trace image outline
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        
        const width = image.width * scale;
        const height = image.height * scale;
        
        tempCanvas.width = width;
        tempCanvas.height = height;
        
        // Draw image
        tempCtx.drawImage(image, 0, 0, width, height);
        
        // Trace the outline
        return this.traceVerticesFromCanvas(tempCanvas);
    }
    
    traceVerticesFromCanvas(canvas) {
        const ctx = canvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const { width, height } = canvas;

        // Find the geometric center of the shape for relative vertex coordinates
        let minX = width, minY = height, maxX = -1, maxY = -1;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (this.isNonWhitePixel(imageData, x, y, width, height)) {
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                }
            }
        }
        const centerX = minX + (maxX - minX) / 2;
        const centerY = minY + (maxY - minY) / 2;

        // Find the first solid pixel to start tracing from
        let startX = -1, startY = -1;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (this.isNonWhitePixel(imageData, x, y, width, height)) {
                    startX = x;
                    startY = y;
                    break;
                }
            }
            if (startX !== -1) break;
        }

        if (startX === -1) {
            console.log('⚠️ No solid pixels found, using bounding box');
            return this.createBoundingBoxVertices(width, height, centerX, centerY);
        }

        // Use Moore neighborhood contour tracing
        const contour = this.mooreNeighborhoodTrace(imageData, width, height, startX, startY);

        if (contour.length < 3) {
            console.log('⚠️ Insufficient contour points, using bounding box');
            return this.createBoundingBoxVertices(width, height, centerX, centerY);
        }

        // Convert to relative coordinates
        const vertices = contour.map(point => ({
            x: point.x - centerX,
            y: point.y - centerY
        }));

        // Simplify the contour
        const simplified = this.douglasPeucker(vertices, 2.0);
        console.log(`✅ Traced and simplified vertices: ${vertices.length} -> ${simplified.length}`);

        return simplified;
    }

    createRibbonCable() {
        if (this.imageCache.has('ribbon_cable')) {
            const img = this.imageCache.get('ribbon_cable');
            const scale = 0.5;
            const x = this.canvas.width * 0.25;
            const y = this.canvas.height * 0.7;

            const obj = {
                text: 'RIBBON_CABLE',
                x, y, image: img, imageScale: scale, rotation: -Math.PI / 8,
                isDraggable: true, isImage: true,
                width: img.width * scale,
                height: img.height * scale,
                kind: 'ribbon_cable'
            };

            const body = this.createAndPositionImageBody(img, x, y, obj.width, obj.height, obj.rotation);

            obj.body = body;
            body.gameObject = obj;
            this.gameObjects.push(obj);
            Matter.World.add(this.world, body);
            this.ribbonCableObj = obj;
        } else {
            setTimeout(() => this.createRibbonCable(), 100);
        }
    }

    createAndPositionImageBody(img, x, y, width, height, rotation) {
        // 1. Create the body. It's now properly centered around its geometric origin.
        const body = this.createAccurateImageBody(img, width, height);

        // 2. Simply set the position and angle.
        Matter.Body.setPosition(body, { x, y });
        Matter.Body.setAngle(body, rotation);

        return body;
    }

    rebuildAllImageCollisions() {
        this.gameObjects.forEach(obj => {
            if (obj.isImage && obj.kind === 'banana') {
                const { x, y, width, height, imageScale } = obj;
                const newBody = this.createAndPositionImageBody(obj.image, x, y, width, height, 0);
                Matter.World.remove(this.world, obj.body);
                obj.body = newBody;
                newBody.gameObject = obj;
                Matter.World.add(this.world, newBody);
            }
            if (obj.isImage && obj.kind === 'ribbon_cable') {
                const { x, y, width, height, imageScale, rotation } = obj;
                const newBody = this.createAndPositionImageBody(obj.image, x, y, width, height, rotation);
                Matter.World.remove(this.world, obj.body);
                obj.body = newBody;
                newBody.gameObject = obj;
                Matter.World.add(this.world, newBody);
            }
        });
        console.log('✅ All image collision bodies rebuilt.');
    }
    
    douglasPeucker(points, tolerance) {
        if (points.length <= 2) return points;
        
        // Find the point with maximum distance from line between first and last
        let maxDistance = 0;
        let maxIndex = 0;
        
        for (let i = 1; i < points.length - 1; i++) {
            const distance = this.pointToLineDistance(
                points[i], points[0], points[points.length - 1]
            );
            if (distance > maxDistance) {
                maxDistance = distance;
                maxIndex = i;
            }
        }
        
        // If max distance is greater than tolerance, recursively simplify
        if (maxDistance > tolerance) {
            const left = this.douglasPeucker(points.slice(0, maxIndex + 1), tolerance);
            const right = this.douglasPeucker(points.slice(maxIndex), tolerance);
            
            // Combine results (remove duplicate point)
            return left.slice(0, -1).concat(right);
        } else {
            // All points between first and last can be removed
            return [points[0], points[points.length - 1]];
        }
    }
    
    pointToLineDistance(point, lineStart, lineEnd) {
        const A = point.x - lineStart.x;
        const B = point.y - lineStart.y;
        const C = lineEnd.x - lineStart.x;
        const D = lineEnd.y - lineStart.y;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        
        if (lenSq === 0) return Math.sqrt(A * A + B * B);
        
        const param = dot / lenSq;
        let xx, yy;
        
        if (param < 0) {
            xx = lineStart.x;
            yy = lineStart.y;
        } else if (param > 1) {
            xx = lineEnd.x;
            yy = lineEnd.y;
        } else {
            xx = lineStart.x + param * C;
            yy = lineStart.y + param * D;
        }
        
        const dx = point.x - xx;
        const dy = point.y - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }
    

    // Inspect the image data to determine if transparency is present
    // We only need a quick signal; sample edges and a coarse grid.
    detectTransparency(imageData) {
        const { width, height, data } = imageData;
        const step = Math.max(1, Math.floor(Math.min(width, height) / 50));
        let transparentSamples = 0;
        let totalSamples = 0;

        // Sample borders (likely background)
        for (let x = 0; x < width; x += step) {
            const topA = data[(0 * width + x) * 4 + 3];
            const botA = data[((height - 1) * width + x) * 4 + 3];
            if (topA < 250) transparentSamples++;
            if (botA < 250) transparentSamples++;
            totalSamples += 2;
        }
        for (let y = 0; y < height; y += step) {
            const leftA = data[(y * width + 0) * 4 + 3];
            const rightA = data[(y * width + (width - 1)) * 4 + 3];
            if (leftA < 250) transparentSamples++;
            if (rightA < 250) transparentSamples++;
            totalSamples += 2;
        }

        // Coarse interior grid sampling
        for (let y = step; y < height; y += step * 5) {
            for (let x = step; x < width; x += step * 5) {
                const a = data[(y * width + x) * 4 + 3];
                if (a < 250) transparentSamples++;
                totalSamples++;
            }
        }

        // If any noticeable portion is below near-opaque, we consider it having transparency
        return transparentSamples > Math.max(5, totalSamples * 0.02);
    }
    
    createBoundingBoxVertices(width, height, centerX, centerY) {
        const w = width, h = height;
        return [
            { x: 0 - centerX, y: 0 - centerY },
            { x: w - centerX, y: 0 - centerY },
            { x: w - centerX, y: h - centerY },
            { x: 0 - centerX, y: h - centerY }
        ];
    }

    mooreNeighborhoodTrace(imageData, width, height, startX, startY) {
        const contour = [];
        let x = startX;
        let y = startY;
        let dir = 0; // 0:N, 1:NE, 2:E, 3:SE, 4:S, 5:SW, 6:W, 7:NW

        const moves = [
            { dx: 0, dy: -1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 0 }, { dx: 1, dy: 1 },
            { dx: 0, dy: 1 }, { dx: -1, dy: 1 }, { dx: -1, dy: 0 }, { dx: -1, dy: -1 }
        ];

        let backTrackDir;

        do {
            contour.push({ x, y });

            // Determine direction to start checking from (based on previous move)
            backTrackDir = (dir + 4) % 8; // The direction opposite to the last move
            let foundNext = false;

            for (let i = 0; i < 8; i++) {
                const checkDir = (backTrackDir + i + 1) % 8;
                const nextX = x + moves[checkDir].dx;
                const nextY = y + moves[checkDir].dy;

                if (this.isNonWhitePixel(imageData, nextX, nextY, width, height)) {
                    x = nextX;
                    y = nextY;
                    dir = checkDir;
                    foundNext = true;
                    break;
                }
            }

            if (!foundNext) {
                // Should not happen in a closed loop, but as a safeguard
                break;
            }

        } while (x !== startX || y !== startY);

        return contour;
    }

    spawnMarble() {
        // Remove existing marble if any
        if (this.marble) {
            Matter.World.remove(this.world, this.marble.body);
        }
        
        const marble = {
            x: this.canvas.width / 2,
            y: -20, // Start above the screen
            radius: 10,
            color: '#FF4444',
            isMarble: true
        };
        
        const body = Matter.Bodies.circle(marble.x, marble.y, marble.radius, {
            restitution: 0.7,
            friction: 0.3,
            density: 0.001
        });
        
        marble.body = body;
        body.gameObject = marble;
        
        this.marble = marble;
        Matter.World.add(this.world, body);
        
        document.getElementById('marbleStatus').textContent = 'Falling';
        
        // Check if marble falls off screen
        setTimeout(() => this.checkMarbleOffScreen(), 1000);
    }
    
    checkMarbleOffScreen() {
        if (this.marble && this.marble.body.position.y > this.canvas.height) {
            // Remove the marble from the world
            Matter.World.remove(this.world, this.marble.body);
            this.marble = null;
            
            document.getElementById('marbleStatus').textContent = 'Respawning...';
            
            // Spawn new marble after brief delay
            setTimeout(() => {
                this.spawnMarble();
            }, 500);
        } else if (this.marble) {
            setTimeout(() => this.checkMarbleOffScreen(), 100);
        }
    }
    
    setupEventListeners() {
        // Mouse events
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        
        // Touch events for mobile
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.handleMouseDown(e.touches[0]);
        });
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.handleMouseMove(e.touches[0]);
        });
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.handleMouseUp(e);
        });
        
        // Audio initialization
        this.canvas.addEventListener('click', () => {
            if (!this.audioInitialized) {
                // Resume audio context and create synth on first user gesture
                Tone.start();
                if (!this.synth) {
                    this.synth = new Tone.Synth().toDestination();
                }
                this.audioInitialized = true;
                document.getElementById('status').textContent = 'Audio enabled! Drag text to interact.';
            }
        });
        
        // Generate button
        document.getElementById('generateBtn').addEventListener('click', () => {
            this.generateObject();
        });
        
        // Toggle collision overlay
        window.addEventListener('keydown', (e) => {
            if (e.key === 'v' || e.key === 'V') {
                this.showCollisionOverlay = !this.showCollisionOverlay;
                const msg = this.showCollisionOverlay ? 'Collision overlay ON (press V to hide)' : 'Collision overlay OFF (press V to show)';
                const statusEl = document.getElementById('status');
                if (statusEl) statusEl.textContent = msg;
            } else if (e.key === 'm' || e.key === 'M') {
                this.showMaskPreview = !this.showMaskPreview;
                const statusEl = document.getElementById('status');
                if (statusEl) statusEl.textContent = this.showMaskPreview ? 'Mask preview ON (press M to hide)' : 'Mask preview OFF (press M to show)';
            } else if (e.key === 'a' || e.key === 'A') {
                this.forceCollisionMode = 'alpha';
                console.log('🔧 Force collision mode: alpha');
            } else if (e.key === 'b' || e.key === 'B') {
                this.forceCollisionMode = 'rgb';
                console.log('🔧 Force collision mode: rgb fallback');
            } else if (e.key === 'o' || e.key === 'O') {
                this.forceCollisionMode = 'auto';
                console.log('🔧 Force collision mode: auto');
            } else if (e.key === 'r' || e.key === 'R') {
                console.log('🔄 Rebuilding all image collision bodies...');
                this.rebuildAllImageCollisions();
            } else if (e.key === 'g' || e.key === 'G') {
                this.showCellDebug = !this.showCellDebug;
                console.log(`🔍 Cell debug ${this.showCellDebug ? 'ON' : 'OFF'}`);
            }
        });
        
        // Collision detection
        Matter.Events.on(this.engine, 'collisionStart', (event) => {
            this.handleCollisions(event.pairs);
        });
    }
    
    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        console.log('🖱️ Mouse down at:', mouseX, mouseY);
        console.log('📋 Checking', this.gameObjects.length, 'objects');
        
        // Find clicked object
        for (const obj of this.gameObjects) {
            console.log('🔍 Checking object:', obj.text || obj.type, 'isDraggable:', obj.isDraggable);
            
            if (obj.isDraggable && this.isPointInObject(mouseX, mouseY, obj)) {
                const centerX = obj.body.position.x;
                const centerY = obj.body.position.y;
                const distFromCenter = Math.sqrt((mouseX - centerX) ** 2 + (mouseY - centerY) ** 2);
                
                if (distFromCenter < 20) {
                    // Drag mode (center click) - smaller zone for easier rotation access
                    console.log('🔵 DRAG MODE activated for:', obj.text, 'distance:', distFromCenter);
                    this.isDragging = true;
                    this.dragTarget = obj;
                    this.dragOffset.x = mouseX - centerX;
                    this.dragOffset.y = mouseY - centerY;
                } else {
                    // Rotation mode (any click outside center)
                    console.log('🔴 ROTATION MODE activated for:', obj.text, 'distance:', distFromCenter);
                    this.isRotating = true;
                    this.dragTarget = obj;
                }
                break;
            } else if (obj.isDraggable) {
                console.log('❌ No hit on:', obj.text || obj.type, 'at position:', obj.body.position.x, obj.body.position.y);
            }
        }
        
        if (!this.isDragging && !this.isRotating) {
            console.log('⚠️ No object clicked - no mode activated');
        }
    }
    
    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        if (this.isDragging && this.dragTarget) {
            const newX = mouseX - this.dragOffset.x;
            const newY = mouseY - this.dragOffset.y;
            
            Matter.Body.setPosition(this.dragTarget.body, { x: newX, y: newY });
            
            // Sync object position with physics body position
            this.dragTarget.x = newX;
            this.dragTarget.y = newY;
            
            // Add colorful trail
            this.addTrail(newX, newY, this.dragTarget.color);
            
        } else if (this.isRotating && this.dragTarget) {
            const centerX = this.dragTarget.body.position.x;
            const centerY = this.dragTarget.body.position.y;
            
            // Calculate angle from initial click position to current mouse position
            if (!this.rotationStartAngle) {
                this.rotationStartAngle = Math.atan2(mouseY - centerY, mouseX - centerX);
                this.initialRotation = this.dragTarget.body.angle;
                console.log('🎯 Starting rotation for:', this.dragTarget.text, 'initial angle:', this.initialRotation);
            }
            
            const currentAngle = Math.atan2(mouseY - centerY, mouseX - centerX);
            const deltaAngle = currentAngle - this.rotationStartAngle;
            const newAngle = this.initialRotation + deltaAngle;
            
            console.log('🔄 Rotating:', this.dragTarget.text, 'delta:', deltaAngle, 'new angle:', newAngle);
            
            // For static bodies, we need to temporarily make them non-static to rotate
            Matter.Body.setStatic(this.dragTarget.body, false);
            Matter.Body.setAngle(this.dragTarget.body, newAngle);
            Matter.Body.setStatic(this.dragTarget.body, true);
            
            // Sync object rotation with physics body
            this.dragTarget.rotation = newAngle;
        }
    }
    
    handleMouseUp(e) {
        console.log('⬆️ MOUSE UP - isDragging:', this.isDragging, 'isRotating:', this.isRotating, 'target:', this.dragTarget?.text);
        
        // Reset rotation tracking variables
        if (this.rotationStartAngle !== null) {
            console.log('🔄 Resetting rotation variables');
        }
        this.rotationStartAngle = null;
        this.initialRotation = null;
        
        this.isDragging = false;
        this.isRotating = false;
        this.dragTarget = null;
        
        console.log('✅ Mouse up complete - all states reset');
    }
    
    isPointInObject(x, y, obj) {
        const objX = obj.body.position.x;
        const objY = obj.body.position.y;
        const width = obj.width || obj.radius * 2;
        const height = obj.height || obj.radius * 2;
        
        return x >= objX - width/2 && x <= objX + width/2 &&
               y >= objY - height/2 && y <= objY + height/2;
    }
    
    addTrail(x, y, color) {
        this.trails.push({
            x: x,
            y: y,
            color: color,
            alpha: 1.0,
            size: 8,
            life: 30
        });
        
        // Limit trail length
        if (this.trails.length > 100) {
            this.trails.shift();
        }
    }
    
    handleCollisions(pairs) {
        for (const pair of pairs) {
            const { bodyA, bodyB } = pair;
            const objA = bodyA.gameObject;
            const objB = bodyB.gameObject;
            
            // Marble hitting text
            if ((objA?.isMarble && objB?.isText) || (objA?.isText && objB?.isMarble)) {
                const textObj = objA?.isText ? objA : objB;
                this.playLetterSound(textObj.text);
                document.getElementById('marbleStatus').textContent = `Hit ${textObj.text}!`;
            }
            
            // Marble hitting cup
            if ((objA?.isMarble && objB?.isCup) || (objA?.isCup && objB?.isMarble)) {
                this.marbleInCup();
            }
        }
    }
    
    playLetterSound(text) {
        if (!this.audioInitialized || !this.synth) return;
        
        // Play different notes for different letters
        const notes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'];
        const noteIndex = text.charCodeAt(0) % notes.length;
        
        this.synth.triggerAttackRelease(notes[noteIndex], '8n');
    }
    
    marbleInCup() {
        this.score += 10;
        document.getElementById('score').textContent = this.score;
        document.getElementById('marbleStatus').textContent = 'In cup!';
        
        // Play success sound
        if (this.audioInitialized && this.synth) {
            this.synth.triggerAttackRelease('C5', '4n');
        }
        
        // Remove marble and spawn new one after delay
        if (this.marble) {
            Matter.World.remove(this.world, this.marble.body);
            this.marble = null;
        }
        
        setTimeout(() => {
            this.spawnMarble();
        }, 2000);
    }
    
    async generateObject() {
        const input = document.getElementById('objectInput');
        const description = input.value.trim();
        
        if (!description) return;
        
        document.getElementById('spinner').style.display = 'block';
        document.getElementById('status').textContent = 'Generating object...';

        try {
            await this.createGeneratedObject(description);
            document.getElementById('status').textContent = `Created: ${description}`;
        } catch (e) {
            console.error('Generation failed', e);
            document.getElementById('status').textContent = 'Generation failed';
        } finally {
            document.getElementById('spinner').style.display = 'none';
            input.value = '';
        }
    }
    
    async createGeneratedObject(description) {
        const x = Math.random() * (this.canvas.width - 100) + 50;
        const y = Math.random() * (this.canvas.height - 200) + 100;
        
        // Check if description mentions an image we have
        const lowerDesc = description.toLowerCase();
        let obj;
        
        // If a URL is present, treat it as an image to load dynamically
        const urlMatch = description.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
            const url = urlMatch[0];
            const nameFromUrl = url.split('/').pop().split('.')[0] || 'image';
            await this.addImageObject(nameFromUrl, url, { x, y, scale: 0.5, tolerance: 48, isStatic: true });
            return;
        }
        
        if (lowerDesc.includes('banana') && this.imageCache.has('banana')) {
            // Use runtime white→alpha processing and accurate collision
            await this.addImageObject('banana', './images/banana.png', { x, y, scale: 0.3, tolerance: 48, isStatic: true });
            return;
        } else {
            // Create text object as fallback
            const color = `hsl(${Math.random() * 360}, 70%, 50%)`;
            this.ctx.font = '24px Arial';
            const textMetrics = this.ctx.measureText(description.substring(0, 10));
            const textWidth = textMetrics.width;
            
            obj = {
                text: description.substring(0, 10),
                x: x,
                y: y,
                color: color,
                fontSize: 24,
                rotation: 0,
                isDraggable: true,
                isText: true,
                width: textWidth + 20,
                height: 40
            };
        }
        // For text, create a simple rectangle body
        const body = Matter.Bodies.rectangle(x, y, obj.width, obj.height, {
            isStatic: true,
            restitution: 0.4,
            friction: 0.6
        });
        obj.body = body;
        body.gameObject = obj;
        this.gameObjects.push(obj);
        Matter.World.add(this.world, body);
    }
    
    update() {
        // Update physics
        Matter.Engine.update(this.engine);
        
        // Update trails
        this.trails = this.trails.filter(trail => {
            trail.life--;
            trail.alpha = trail.life / 30;
            return trail.life > 0;
        });
    }
    
    render() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        // Draw trails
        for (const trail of this.trails) {
            this.ctx.save();
            this.ctx.globalAlpha = trail.alpha;
            this.ctx.fillStyle = trail.color;
            this.ctx.beginPath();
            this.ctx.arc(trail.x, trail.y, trail.size, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        }
        
        // Draw game objects
        for (const obj of this.gameObjects) {
            this.ctx.save();
            
            if (obj.isText) {
                // Draw text
                this.ctx.translate(obj.body.position.x, obj.body.position.y);
                this.ctx.rotate(obj.body.angle);
                this.ctx.fillStyle = obj.color;
                this.ctx.font = `bold ${obj.fontSize}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillText(obj.text, 0, 0);
            } else if (obj.isImage && obj.image) {
                // Draw image
                this.ctx.translate(obj.body.position.x, obj.body.position.y);
                this.ctx.rotate(obj.body.angle);
                const off = (obj.body && obj.body.renderOffset) ? obj.body.renderOffset : { x: 0, y: 0 };
                this.ctx.drawImage(
                    obj.image,
                    -obj.width / 2 - off.x,
                    -obj.height / 2 - off.y,
                    obj.width,
                    obj.height
                );
                // Optional alpha-mask preview with checkerboard
                if (this.showMaskPreview) {
                    const cbSize = 10;
                    for (let yy = -obj.height / 2; yy < obj.height / 2; yy += cbSize) {
                        for (let xx = -obj.width / 2; xx < obj.width / 2; xx += cbSize) {
                            const even = (((xx / cbSize) | 0) + ((yy / cbSize) | 0)) % 2 === 0;
                            this.ctx.fillStyle = even ? 'rgba(200,200,200,0.7)' : 'rgba(240,240,240,0.7)';
                            this.ctx.fillRect(xx, yy, cbSize, cbSize);
                        }
                    }
                    // Draw the image again to visualize transparent cutouts over checkerboard
                    const off2 = (obj.body && obj.body.renderOffset) ? obj.body.renderOffset : { x: 0, y: 0 };
                    this.ctx.drawImage(
                        obj.image,
                        -obj.width / 2 - off2.x,
                        -obj.height / 2 - off2.y,
                        obj.width,
                        obj.height
                    );
                    this.ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                    this.ctx.strokeRect(-obj.width/2 - off2.x, -obj.height/2 - off2.y, obj.width, obj.height);
                }
            }
            
            // Draw collision vertices for debugging (instead of hitbox indicators)
            if (this.showCollisionOverlay && obj.isDraggable && obj.body) {
                const bodyPos = obj.body.position;
                const angle = obj.body.angle;
                const cos = Math.cos(-angle);
                const sin = Math.sin(-angle);
                const toLocal = (p) => {
                    const dx = p.x - bodyPos.x;
                    const dy = p.y - bodyPos.y;
                    return { x: dx * cos - dy * sin, y: dx * sin + dy * cos };
                };

                this.ctx.strokeStyle = 'rgba(255,0,0,0.8)';
                this.ctx.lineWidth = 2;
                this.ctx.fillStyle = 'rgba(255,0,0,0.2)';

                const parts = obj.body.parts && obj.body.parts.length > 1 ? obj.body.parts.slice(1) : [obj.body];
                for (const part of parts) {
                    const vertices = part.vertices || [];
                    if (vertices.length === 0) continue;

                    // Convert vertices to local body space
                    const localVerts = vertices.map(toLocal);

                    this.ctx.beginPath();
                    this.ctx.moveTo(localVerts[0].x, localVerts[0].y);
                    for (let i = 1; i < localVerts.length; i++) {
                        this.ctx.lineTo(localVerts[i].x, localVerts[i].y);
                    }
                    this.ctx.closePath();
                    this.ctx.fill();
                    this.ctx.stroke();

                    // Draw vertex points
                    this.ctx.fillStyle = 'rgba(255,255,0,0.8)';
                    for (const v of localVerts) {
                        this.ctx.beginPath();
                        this.ctx.arc(v.x, v.y, 3, 0, Math.PI * 2);
                        this.ctx.fill();
                    }
                    this.ctx.fillStyle = 'rgba(255,0,0,0.2)'; // restore fill for subsequent parts
                }

                // Small center dot for drag reference
                this.ctx.fillStyle = 'rgba(0,255,0,0.8)';
                this.ctx.beginPath();
                this.ctx.arc(0, 0, 4, 0, Math.PI * 2);
                this.ctx.fill();
            } else if (obj.isCup) {
                // Draw cup
                this.ctx.translate(obj.body.position.x, obj.body.position.y);
                this.ctx.fillStyle = obj.color;
                this.ctx.fillRect(-obj.width/2, -obj.height/2, obj.width, obj.height);
                
                // Cup opening
                this.ctx.fillStyle = '#333';
                this.ctx.fillRect(-obj.width/2 + 5, -obj.height/2, obj.width - 10, 10);
            }
            
            this.ctx.restore();
        }
        
        // Draw marble
        if (this.marble) {
            this.ctx.save();
            this.ctx.translate(this.marble.body.position.x, this.marble.body.position.y);
            this.ctx.fillStyle = this.marble.color;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, this.marble.radius, 0, Math.PI * 2);
            this.ctx.fill();
            
            // Marble highlight
            this.ctx.fillStyle = 'rgba(255,255,255,0.3)';
            this.ctx.beginPath();
            this.ctx.arc(-4, -4, this.marble.radius * 0.3, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        }
    }
    
    startGameLoop() {
        const gameLoop = () => {
            this.update();
            this.render();
            requestAnimationFrame(gameLoop);
        };
        
        gameLoop();
    }
}

// Initialize game when page loads
window.addEventListener('load', () => {
    new MusicalMarbleDrop();
});
