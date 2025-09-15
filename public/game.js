// Musical Marble Drop Physics Game
class MusicalMarbleDrop {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.engine = Matter.Engine.create();
        this.world = this.engine.world;
        
        this.gameObjects = [];
        this.generatedObjects = [];
        this.marbles = [];
        this.score = 0;
        this.initialSpawnPos = null; // record original single-marble spawn location
        this.targetMarbleCount = 1; // start with 1 marble
        this.gameOver = false;
        this.phase = 'single'; // 'single' -> 'final'
        this.imageCache = new Map(); // Cache for loaded images
        this.pixelDataCache = new Map(); // Cache for per-object pixel data
        // Alpha-based collision settings
        this.alphaThreshold = 128; // pixels with alpha >= threshold are solid (ignore faint antialiasing)
        this.useAlphaForCollision = true; // prefer alpha channel when available
        this.treatWhiteAsTransparent = true; // treat pure white like transparency
        this.whiteToAlphaTolerance = 10; // how close to white a pixel must be to be transparent
        // Debug overlay
        this.showCollisionOverlay = false; // press 'V' to toggle
        this.showMaskPreview = false; // press 'M' to toggle alpha-mask preview
        this.forceCollisionMode = 'auto'; // 'auto' | 'alpha' | 'rgb' (press 'A'/'B')
        this.showCellDebug = false; // press 'G' to toggle grid cell debug
        this.lastCollisionGrid = null; // stores last built grid for banana
        // Track folder images that have been placed to avoid duplicates
        this.placedFolderImages = new Set();
        // Track image-based cup and wastebasket objects
        this.imageCupObj = null;
        this.imageWastebasketObj = null;
        this.deleteIndicator = null;
        this.deletePopover = null;
        
        // Audio
        this.audioInitialized = false;
        this.synth = null;
        
        this.isDragging = false;
        this.isRotating = false;
        this.dragTarget = null;
        this.dragOffset = { x: 0, y: 0 };
        this.dragZoneRadius = 40; // Radius for center drag zone
        this.initialRotation = null;
        this.rotationStartAngle = null;
        this.animations = []; // For pluck/bounce effects
        this.textEffects = []; // For rainbow trails on text
        this.hoverTarget = null; // latch hovered draggable to stabilize cursor
        
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
            { name: 'arduino', path: './images/arduino.png' },
            { name: 'banana', path: './images/banana.png' },
            { name: 'boing', path: './images/boing.png' },
            { name: 'cup', path: './images/cup.png' },
            { name: 'eprom', path: './images/eprom.png' },
            { name: 'hotgluegun', path: './images/hotgluegun.png' },
            { name: 'pencil', path: './images/pencil.png' },
            { name: 'ribbon_cable_2', path: './images/ribbon_cable_2.png' },
            { name: 'ruler', path: './images/ruler.png' },
            { name: 'skateboard', path: './images/skateboard.png' },
            { name: 'slipon', path: './images/slipon.png' },
            { name: 'sunglasses', path: './images/sunglasses.png' },
            { name: 'wastebasket', path: './images/wastebasket.png' },
            { name: 'wrench', path: './images/wrench.png' }
        ];

        imagesToLoad.forEach(async (imageInfo) => {
            try {
                const processed = await this.loadAndProcessImage(imageInfo.name, imageInfo.path, this.whiteToAlphaTolerance);
                console.log(`✅ Loaded + processed image: ${imageInfo.name}`, processed.width, processed.height);
            } catch (e) {
                console.error(`❌ Failed to load/process image: ${imageInfo.path}`, e);
            }
        });
    }

    // Dynamically load an image and key out near-white to transparency; caches result
    loadAndProcessImage(name, url, tolerance = this.whiteToAlphaTolerance) {
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
        const { x = this.canvas.width / 2, y = this.canvas.height / 2, scale = 1, tolerance = this.whiteToAlphaTolerance, isStatic = true } = options;
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
                friction: 0.01,
                frictionStatic: 0.005
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

    // Add an image that was already loaded into imageCache (no re-fetch)
    addCachedImageObject(name, x, y, options = {}) {
        const { scale = 1, isStatic = true, rotation = 0 } = options;
        if (!this.imageCache.has(name)) return null;
        const imgCanvas = this.imageCache.get(name);
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
            body = this.createAndPositionImageBody(imgCanvas, x, y, width, height, rotation);
        } catch (e) {
            console.error('Failed to create accurate body for cached image, falling back to rectangle', e);
            body = Matter.Bodies.rectangle(x, y, width, height, {
                isStatic: isStatic,
                restitution: 0.4,
                friction: 0.01,
                frictionStatic: 0.005
            });
        }
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
        // Fixed play area dimensions
        this.gameWidth = 1200;
        this.gameHeight = 800;
        
        // Calculate scale to fit screen while maintaining aspect ratio
        const scaleX = window.innerWidth / this.gameWidth;
        const scaleY = window.innerHeight / this.gameHeight;
        this.canvasScale = Math.min(scaleX, scaleY, 1); // Don't scale up beyond 1:1
        
        // Set actual canvas size
        this.canvas.width = this.gameWidth;
        this.canvas.height = this.gameHeight;
        
        // Apply CSS scaling to fit screen
        this.canvas.style.width = `${this.gameWidth * this.canvasScale}px`;
        this.canvas.style.height = `${this.gameHeight * this.canvasScale}px`;
        
        // Center the canvas
        this.canvas.style.position = 'absolute';
        this.canvas.style.left = '50%';
        this.canvas.style.top = '50%';
        this.canvas.style.transform = 'translate(-50%, -50%)';
        
        window.addEventListener('resize', () => {
            const scaleX = window.innerWidth / this.gameWidth;
            const scaleY = window.innerHeight / this.gameHeight;
            this.canvasScale = Math.min(scaleX, scaleY, 1);
            
            this.canvas.style.width = `${this.gameWidth * this.canvasScale}px`;
            this.canvas.style.height = `${this.gameHeight * this.canvasScale}px`;
        });
    }
    
    setupPhysics() {
        // Set gravity
        this.engine.world.gravity.y = 0.8;
        
        // Create boundaries (invisible walls) - no bottom wall so marble can fall through
        const boundaries = [
            // Left
            Matter.Bodies.rectangle(-50, this.gameHeight / 2, 100, this.gameHeight, { isStatic: true }),
            // Right  
            Matter.Bodies.rectangle(this.gameWidth + 50, this.gameHeight / 2, 100, this.gameHeight, { isStatic: true }),
            // Top
            Matter.Bodies.rectangle(this.gameWidth / 2, -250, this.gameWidth, 100, { isStatic: true })
        ];

        Matter.World.add(this.world, boundaries);

        // Boundary sensor frame (non-physical) to end drag/rotate when crossing play area edges
        // These do NOT affect physics (isSensor: true) and exist exactly on the inner edges
        const sensorThickness = 4;
        const boundarySensors = [
            // Left edge sensor
            Matter.Bodies.rectangle(0, this.gameHeight / 2, sensorThickness, this.gameHeight + sensorThickness * 2, {
                isStatic: true,
                isSensor: true
            }),
            // Right edge sensor
            Matter.Bodies.rectangle(this.gameWidth, this.gameHeight / 2, sensorThickness, this.gameHeight + sensorThickness * 2, {
                isStatic: true,
                isSensor: true
            }),
            // Top edge sensor
            Matter.Bodies.rectangle(this.gameWidth / 2, 0, this.gameWidth + sensorThickness * 2, sensorThickness, {
                isStatic: true,
                isSensor: true
            }),
            // Bottom edge sensor (kept as sensor so marbles can still fall out visually if needed)
            Matter.Bodies.rectangle(this.gameWidth / 2, this.gameHeight, this.gameWidth + sensorThickness * 2, sensorThickness, {
                isStatic: true,
                isSensor: true
            })
        ];

        // Tag sensors
        boundarySensors[0].gameObject = { isBoundarySensor: true, edge: 'left' };
        boundarySensors[1].gameObject = { isBoundarySensor: true, edge: 'right' };
        boundarySensors[2].gameObject = { isBoundarySensor: true, edge: 'top' };
        boundarySensors[3].gameObject = { isBoundarySensor: true, edge: 'bottom' };

        Matter.World.add(this.world, boundarySensors);
    }

    async createInitialScene() {
        await document.fonts.ready;

        const w = this.gameWidth;
        const h = this.gameHeight;

        // Create the sloped sentence for the marble to roll down
        const sentence = ["MAKING", "STUFF", "IS", "RAD."];
        const angle = 0.1; // Reduced slope
        const wordSpacing = 25; // Increased spacing
        let currentY = h * 0.15;

        // Pre-measure all words to get their widths
        this.ctx.font = 'bold 96px "Passion One"';
        const wordWidths = sentence.map(word => this.ctx.measureText(word).width);

        // Calculate the total width of the sentence to center it
        const totalSentenceWidth = wordWidths.reduce((sum, w) => sum + w, 0) + (sentence.length - 1) * wordSpacing;
        let currentX = (w - totalSentenceWidth) / 2;

        for (let i = 0; i < sentence.length; i++) {
            const word = sentence[i];
            const currentWidth = wordWidths[i];

            // Adjust currentX to be the center of the current word
            if (i === 0) {
                currentX += currentWidth / 2;
            } else {
                const prevWidth = wordWidths[i - 1];
                const offset = (prevWidth / 2) + (currentWidth / 2) + wordSpacing;
                currentX += Math.cos(angle) * offset;
                currentY += Math.sin(angle) * offset;
            }

            this.createTextObject(word, currentX, currentY, 'black', angle);

            if (i > 0) {
                // Add an invisible filler rectangle between the words
                const fillerWidth = wordSpacing + 2; // Add a little overlap
                const fillerHeight = 10;
                const prevTextObj = this.gameObjects[this.gameObjects.length - 2];

                const gapCenterDist = (wordWidths[i-1] / 2) + (wordSpacing / 2);
                const fillerX = prevTextObj.body.position.x + Math.cos(angle) * gapCenterDist;
                const fillerY = prevTextObj.body.position.y + Math.sin(angle) * gapCenterDist;

                const filler = Matter.Bodies.rectangle(fillerX, fillerY, fillerWidth, fillerHeight, {
                    isStatic: true,
                    angle: angle,
                    render: { visible: false } // Make it invisible
                });
                Matter.World.add(this.world, filler);
            }
        }

        // Set marble spawn position to be over the 'M' in 'MAKING'
        const makingObj = this.gameObjects.find(obj => obj.text === 'MAKING');
        if (makingObj) {
            const makingBody = makingObj.body;
            const spawnX = makingBody.position.x - makingBody.bounds.min.x + makingBody.position.x - makingObj.width / 2;
            this.initialSpawnPos = { x: makingBody.position.x - makingObj.width / 2 + 30, y: -20 };
        } else {
            // Fallback to top-center if 'MAKING' isn't found for some reason
            this.initialSpawnPos = { x: w / 2, y: -20 };
        }

        // Wait for images to load before placing them
        const placeImages = () => {
            if (this.imageCache.size < 14) { // Wait for all 14 images
                setTimeout(placeImages, 100);
                return;
            }

            // Try to load scene layout, fallback to default if not found
            this.loadSceneLayout();
        };

        placeImages();
    }



    // Create an image-based cup using cup.png as a static sensor
    createImageCupAt(x, y) {
        if (!this.imageCache.has('cup')) return null;
        const img = this.imageCache.get('cup');
        const scale = 1;
        const width = img.width * scale;
        const height = img.height * scale;

        const obj = {
            text: 'CUP',
            x, y,
            image: img,
            imageScale: scale,
            rotation: 0,
            isDraggable: false,
            isImage: true,
            isCup: true,
            width, height
        };

        let body;
        try {
            body = this.createAndPositionImageBody(img, x, y, width, height, 0);
        } catch (e) {
            console.error('Failed to create accurate image cup body, falling back to rectangle', e);
            body = Matter.Bodies.rectangle(x, y, width, height, {
                friction: 0.01,
                frictionStatic: 0.005
            });
        }
        // Make the cup body static and solid (not a sensor) so sides have physics
        Matter.Body.setStatic(body, true);

        obj.body = body;
        body.gameObject = obj;
        this.gameObjects.push(obj);
        Matter.World.add(this.world, body);

        // Add a thin invisible sensor at the top opening
        const sensorWidth = Math.max(20, Math.round(width * 0.6));
        const sensorHeight = Math.max(6, Math.round(height * 0.05));
        const sensorY = y - height / 2 + sensorHeight / 2 + 20; // moved down to be closer to cup top
        const topSensor = Matter.Bodies.rectangle(x, sensorY, sensorWidth, sensorHeight, {
            isStatic: true,
            isSensor: true
        });
        const sensorObj = { isCupTopSensor: true, parentCup: obj };
        topSensor.gameObject = sensorObj;
        Matter.World.add(this.world, topSensor);
        obj.topSensorBody = topSensor;

        return obj;
    }

    // Create an image-based wastebasket using wastebasket.png as a static sensor
    createImageWastebasketAt(x, y) {
        if (!this.imageCache.has('wastebasket')) return null;
        const img = this.imageCache.get('wastebasket');
        const scale = 1;
        const width = img.width * scale;
        const height = img.height * scale;

        const obj = {
            text: 'WASTEBASKET',
            x, y,
            image: img,
            imageScale: scale,
            rotation: 0,
            isDraggable: false,
            isImage: true,
            isWastebasket: true,
            width, height
        };

        let body;
        try {
            body = this.createAndPositionImageBody(img, x, y, width, height, 0);
        } catch (e) {
            console.error('Failed to create accurate wastebasket body, falling back to rectangle', e);
            body = Matter.Bodies.rectangle(x, y, width, height, {
                friction: 0.01,
                frictionStatic: 0.005
            });
        }
        // Make the wastebasket body static and solid
        Matter.Body.setStatic(body, true);

        obj.body = body;
        body.gameObject = obj;
        this.gameObjects.push(obj);
        Matter.World.add(this.world, body);

        // Add a sensor area for delete detection
        const sensorWidth = Math.max(40, Math.round(width * 0.8));
        const sensorHeight = Math.max(40, Math.round(height * 0.8));
        const deleteSensor = Matter.Bodies.rectangle(x, y, sensorWidth, sensorHeight, {
            isStatic: true,
            isSensor: true
        });
        const sensorObj = { isWastebasketSensor: true, parentWastebasket: obj };
        deleteSensor.gameObject = sensorObj;
        Matter.World.add(this.world, deleteSensor);
        obj.deleteSensorBody = deleteSensor;

        return obj;
    }
    
    createTextObject(text, x, y, color, rotation = 0) {
        // Set font to measure text accurately
                this.ctx.font = 'bold 96px "Passion One"';
                const textMetrics = this.ctx.measureText(text);
        const textWidth = textMetrics.width;
                        const textHeight = (textMetrics.actualBoundingBoxAscent + textMetrics.actualBoundingBoxDescent) * 0.85; // Fine-tune the height
                const finalHeight = textHeight + 13; // Add 13px to the top

        const textObj = {
            text: text,
            x: x,
            y: y,
            color: color,
            fontSize: 96,
            rotation: rotation, // Use passed-in rotation
            isDraggable: false,
            isText: true,
            width: textWidth,
            height: finalHeight,
            lastPlayed: 0,
            history: [],
            lastBounceTime: 0
        };

        // Create a static physics body for the text
        const body = Matter.Bodies.rectangle(x, y, textObj.width, textObj.height, {
            isStatic: true,
            restitution: 0.3, // Reduced bounce for more subtle marble interactions
            friction: 0.02,
            angle: rotation // Set the angle directly
        });

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
            const scale = 1;
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
                    friction: 0.02,
                    frictionStatic: 0.01
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

    // Check if dragged item is over wastebasket
    checkWastebasketHover(x, y) {
        if (!this.imageWastebasketObj || !this.dragTarget) return;
        
        if (this.isOverWastebasket(x, y)) {
            // Set opacity to 50% when hovering over wastebasket during drag
            this.dragTarget.deleteHoverOpacity = 0.5;
        } else {
            // Reset opacity when not hovering
            this.dragTarget.deleteHoverOpacity = 1.0;
        }
    }

    // Check if coordinates are over wastebasket sensor
    isOverWastebasket(x, y) {
        if (!this.imageWastebasketObj) return false;
        
        const wastebasket = this.imageWastebasketObj;
        const dx = x - wastebasket.x;
        const dy = y - wastebasket.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        return distance < Math.max(wastebasket.width, wastebasket.height) * 0.4;
    }

    // Show red "Delete?" indicator
    showDeleteIndicator() {
        if (this.deleteIndicator) return; // Already showing
        
        this.deleteIndicator = {
            text: 'Delete?',
            x: this.imageWastebasketObj.x,
            y: this.imageWastebasketObj.y - 60,
            color: '#ff0000',
            fontSize: 24,
            visible: true
        };
    }

    // Hide delete indicator
    hideDeleteIndicator() {
        this.deleteIndicator = null;
    }

    // Show confirmation popover
    showDeleteConfirmation(targetObject) {
        if (this.deletePopover) return; // Already showing
        
        // Store reference to target object and keep it at 50% opacity while popover is shown
        this.deleteTargetObject = targetObject;
        targetObject.deleteHoverOpacity = 0.5;
        
        // Create popover overlay
        const popover = document.createElement('div');
        popover.id = 'deletePopover';
        
        // Calculate position relative to wastebasket
        const canvasRect = this.canvas.getBoundingClientRect();
        const wastebasketScreenX = canvasRect.left + this.imageWastebasketObj.x;
        const wastebasketScreenY = canvasRect.top + this.imageWastebasketObj.y - (this.imageWastebasketObj.height / 2) - 50;
        
        popover.style.cssText = `
            position: fixed;
            left: ${wastebasketScreenX}px;
            top: ${wastebasketScreenY}px;
            transform: translate(-50%, -100%);
            background: white;
            border: 2px solid #ccc;
            border-radius: 8px;
            padding: 20px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            z-index: 1000;
            font-family: Arial, sans-serif;
            text-align: center;
        `;
        
        popover.innerHTML = `
            <div style="margin-bottom: 15px; font-size: 16px; color: #333;">
                Are you sure?
            </div>
            <button id="cancelDelete" style="
                margin-right: 10px;
                padding: 8px 16px;
                background: #f0f0f0;
                border: 1px solid #ccc;
                border-radius: 4px;
                cursor: pointer;
            ">Cancel</button>
            <button id="confirmDelete" style="
                padding: 8px 16px;
                background: #ff4444;
                color: white;
                border: 1px solid #cc0000;
                border-radius: 4px;
                cursor: pointer;
            ">Delete</button>
        `;
        
        document.body.appendChild(popover);
        this.deletePopover = popover;
        
        // Add event listeners
        document.getElementById('cancelDelete').addEventListener('click', () => {
            this.hideDeleteConfirmation();
        });
        
        document.getElementById('confirmDelete').addEventListener('click', () => {
            this.deleteObject(targetObject);
            this.hideDeleteConfirmation();
        });
    }

    // Hide confirmation popover
    hideDeleteConfirmation() {
        if (this.deletePopover) {
            document.body.removeChild(this.deletePopover);
            this.deletePopover = null;
            
            // Reset opacity when popover is hidden (only if object still exists)
            if (this.deleteTargetObject && this.deleteTargetObject.deleteHoverOpacity !== undefined) {
                delete this.deleteTargetObject.deleteHoverOpacity;
            }
        }
    }

    // Delete object from scene
    deleteObject(targetObject) {
        if (!targetObject) return;
        
        // Remove from physics world
        Matter.World.remove(this.world, targetObject.body);
        
        // Remove from game objects array
        const index = this.gameObjects.indexOf(targetObject);
        if (index > -1) {
            this.gameObjects.splice(index, 1);
        }
        
        // Remove any constraints
        if (targetObject.constraint) {
            Matter.World.remove(this.world, targetObject.constraint);
        }
        
        console.log(`🗑️ Deleted object: ${targetObject.text}`);
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
            friction: 0.01,
            frictionStatic: 0.005
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
            tempCtx.font = `bold ${obj.fontSize}px "Passion One"`;
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
            const objA = bodyA.gameObject;
            const objB = bodyB.gameObject;
            const isMarbleA = objA && objA.isMarble;
            const isMarbleB = objB && objB.isMarble;
            const other = isMarbleA ? objB : isMarbleB ? objA : null;
            if (!other || other.isCup || other.isCupTopSensor) continue;
            // if (other.isText && this.audioInitialized) {
            //     const now = Date.now();
            //     const cooldown = 100; // 100ms cooldown
            //     if (now - (other.lastPlayed || 0) > cooldown) {
            //         other.lastPlayed = now;
            //         this.playLetterSound(other.text.charAt(0));
            //     }
            // }
        }
    }
    
    traceTextVertices(text, fontSize) {
        // Create temporary canvas to trace text outline
        const tempCanvas = document.createElement('canvas');
        const tempCtx = tempCanvas.getContext('2d');
        
        // Set canvas size based on text
        tempCtx.font = `bold ${fontSize}px "Passion One"`;
        const metrics = tempCtx.measureText(text);
                const width = metrics.width;
                const height = fontSize;
        
        tempCanvas.width = width;
        tempCanvas.height = height;
        
        // Draw text
        tempCtx.font = `bold ${fontSize}px "Passion One"`;
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
            const scale = 1;
            const x = this.canvas.width * 0.25;
            const y = this.canvas.height * 0.7;

            const obj = {
                text: 'RIBBON_CABLE',
                x, y, image: img, imageScale: scale, rotation: -Math.PI / 8,
                isDraggable: true, isImage: true, isStatic: true,
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

    spawnMarble(x = this.canvas.width / 2, y = -20, color = '#FF4444') {
        const marble = {
            x,
            y,
            radius: 12.5, // 25% bigger
            color,
            isMarble: true
        };
        const body = Matter.Bodies.circle(marble.x, marble.y, marble.radius, {
            restitution: 0.7,
            friction: 0.005,      // Reduced friction
            frictionStatic: 0.0025, // Reduced static friction
            frictionAir: 0.004,
            density: 0.05, // Increased density for a 'heavier' feel
        });
        marble.body = body;
        body.gameObject = marble;
        this.marbles.push(marble);
        Matter.World.add(this.world, body);
        // Record the initial spawn position during the single-marble phase
        if (this.phase === 'single' && !this.initialSpawnPos) {
            this.initialSpawnPos = { x, y };
        }
        const statusEl = document.getElementById('marbleStatus');
        if (statusEl) statusEl.textContent = `Marbles: ${this.marbles.length}`;
        return marble;
    }

    spawnMultipleMarbles(count = 10) {
        const colors = [];
        for (let i = 0; i < count; i++) {
            const hue = Math.floor((360 / count) * i);
            colors.push(`hsl(${hue}, 80%, 55%)`);
        }
        if (count === 1 && this.initialSpawnPos) {
            // For the first single marble, use the dedicated spawn position
            this.spawnMarble(this.initialSpawnPos.x, this.initialSpawnPos.y, colors[0]);
        } else {
            // For other cases (like respawning), spread them out
            for (let i = 0; i < count; i++) {
                const x = (this.canvas.width * (i + 1)) / (count + 1);
                const y = -20 - i * 10; // slight stagger to reduce initial collisions
                this.spawnMarble(x, y, colors[i]);
            }
        }
        const statusEl = document.getElementById('marbleStatus');
        if (statusEl) statusEl.textContent = `Dropping ${count} marbles`;
    }

    // Final release: drop N marbles from the same original spawn point, spaced by intervalMs
    releaseFinalMarblesSequential(count = 10, intervalMs = 250) {
        const origin = this.initialSpawnPos || { x: this.canvas.width / 2, y: -20 };
        for (let i = 0; i < count; i++) {
            const hue = Math.floor((360 / count) * i);
            const color = `hsl(${hue}, 80%, 55%)`;
            setTimeout(() => {
                this.spawnMarble(origin.x, origin.y, color);
            }, i * intervalMs);
        }
        const statusEl = document.getElementById('marbleStatus');
        if (statusEl) statusEl.textContent = `Releasing ${count} marbles...`;
    }

    checkMarblesOffScreen() {
        const removed = [];
        this.marbles = this.marbles.filter(m => {
            const off = m.body.position.y > this.canvas.height + 50;
            if (off) {
                Matter.World.remove(this.world, m.body);
                removed.push(m);
                return false;
            }
            return true;
        });
        if (removed.length > 0) {
            const statusEl = document.getElementById('marbleStatus');
            if (statusEl) statusEl.textContent = `Marbles: ${this.marbles.length}`;
            // Optionally respawn to maintain target count
            const deficit = Math.max(0, this.targetMarbleCount - this.marbles.length);
            if (deficit > 0) {
                setTimeout(() => this.spawnMultipleMarbles(deficit), 500);
            }
        }
    }
    
    // Convert screen coordinates to game coordinates
    getGameCoordinates(e) {
        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.gameWidth / rect.width;
        const scaleY = this.gameHeight / rect.height;
        
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
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
        
        // Enter key submission for input field
        document.getElementById('objectInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                this.generateObject();
            }
        });
        
        // Admin save scene layout (Ctrl+Shift+S)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'S' && e.ctrlKey && e.shiftKey) {
                e.preventDefault();
                this.saveSceneLayout();
                return;
            }
            
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
    
    updateCursor(e) {
        const coords = this.getGameCoordinates(e);
        const mouseX = coords.x;
        const mouseY = coords.y;
        let cursorSet = false;

        if (this.isDragging) {
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        for (const obj of this.gameObjects) {
            if (obj.isDraggable && this.isPointInObject(mouseX, mouseY, obj)) {
                const centerX = obj.body.position.x;
                const centerY = obj.body.position.y;
                const distFromCenter = Math.sqrt((mouseX - centerX) ** 2 + (mouseY - centerY) ** 2);

                if (distFromCenter < this.dragZoneRadius) {
                    this.canvas.style.cursor = 'grab';
                } else {
                    this.canvas.style.cursor = `url('data:image/svg+xml;utf8,<svg width="24" height="24" viewBox="0 0 112 100" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M76.2598 47.1836C78.8732 46.2924 81.714 47.6885 82.6055 50.3018L85.7666 59.5723C86.5701 56.5186 87 53.3113 87 50C87 29.2893 70.2106 12.5 49.5 12.5C28.7893 12.5 12 29.2893 12 50C12 70.7106 28.7893 87.5 49.5 87.5C52.2614 87.5 54.5 89.7386 54.5 92.5C54.5 95.2614 52.2614 97.5 49.5 97.5C23.2665 97.5 2 76.2334 2 50C2 23.7665 23.2665 2.5 49.5 2.5C75.7334 2.5 97 23.7665 97 50C97 54.4602 96.3824 58.7801 95.2305 62.8779L102.886 60.2676C105.499 59.3763 108.341 60.7723 109.232 63.3857C110.124 65.9993 108.728 68.841 106.114 69.7324L87.9629 75.9229H87.9619L86.2578 76.5039C83.6443 77.3947 80.8033 75.9981 79.9121 73.3848L73.1406 53.5303C72.2493 50.9166 73.6461 48.0749 76.2598 47.1836Z" fill="black" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>') 12 12, auto`;
                }
                cursorSet = true;
                break;
            }
        }

        if (!cursorSet) {
            this.canvas.style.cursor = 'default';
        }
    }

    handleMouseDown(e) {
        const coords = this.getGameCoordinates(e);
        const mouseX = coords.x;
        const mouseY = coords.y;

        for (const obj of this.gameObjects) {
            if (obj.isDraggable && this.isPointInObject(mouseX, mouseY, obj)) {
                const centerX = obj.body.position.x;
                const centerY = obj.body.position.y;
                const distFromCenter = Math.sqrt((mouseX - centerX) ** 2 + (mouseY - centerY) ** 2);

                this.dragTarget = obj;

                if (distFromCenter < this.dragZoneRadius) {
                    this.isDragging = true;
                    this.addAnimation('pluck', obj); // Animation only here
                    this.dragOffset.x = mouseX - centerX;
                    this.dragOffset.y = mouseY - centerY;

                    // If the object has a spring, remove it during drag
                    if (obj.isText && obj.constraint) {
                        Matter.World.remove(this.world, obj.constraint);
                    }
                } else {
                    // Rotation mode
                    this.isRotating = true;
                    this.initialRotation = this.dragTarget.body.angle;
                    this.rotationStartAngle = Math.atan2(mouseY - centerY, mouseX - centerX);
                }
                break; // Found a draggable object, no need to check others
            }
        }
        this.updateCursor(e);
    }
    
    handleMouseMove(e) {
        const coords = this.getGameCoordinates(e);
        const mouseX = coords.x;
        const mouseY = coords.y;
        
        if (this.isDragging && this.dragTarget) {
            const newX = mouseX - this.dragOffset.x;
            const newY = mouseY - this.dragOffset.y;
            
            Matter.Body.setPosition(this.dragTarget.body, { x: newX, y: newY });
            
            // Check if dragging over wastebasket
            this.checkWastebasketHover(newX, newY);
            
        } else if (this.isRotating && this.dragTarget) {
            const currentAngle = Math.atan2(mouseY - this.dragTarget.body.position.y, mouseX - this.dragTarget.body.position.x);
            const angleChange = currentAngle - this.rotationStartAngle;
            const newAngle = this.initialRotation + angleChange;

            // For static bodies, we need to temporarily make them non-static to rotate
            if (this.dragTarget.body.isStatic) {
                Matter.Body.setStatic(this.dragTarget.body, false);
                Matter.Body.setAngle(this.dragTarget.body, newAngle);
                Matter.Body.setStatic(this.dragTarget.body, true);
            } else {
                Matter.Body.setAngle(this.dragTarget.body, newAngle);
            }
            
            // Sync object rotation with physics body
            this.dragTarget.rotation = newAngle;
        }
    }
    
    handleMouseUp(e) {
        this.updateCursor(e);
        console.log('⬆️ MOUSE UP - isDragging:', this.isDragging, 'isRotating:', this.isRotating, 'target:', this.dragTarget?.text);
        
        // Reset rotation tracking variables
        if (this.dragTarget) {
            // Check if dropped over wastebasket
            if (this.isDragging && this.isOverWastebasket(this.dragTarget.body.position.x, this.dragTarget.body.position.y)) {
                this.showDeleteConfirmation(this.dragTarget);
            } else {
                // Re-add the spring constraint if it was a dragged text object
                if (this.isDragging && this.dragTarget.isText) {
                    const { body } = this.dragTarget;
                    const newConstraint = Matter.Constraint.create({
                        pointA: { x: body.position.x, y: body.position.y }, // Anchor to the new position
                        bodyB: body,
                        stiffness: 0.02, // Even lower stiffness for a softer spring
                        damping: 0.07 // Higher damping for a slower bounce
                    });
                    this.dragTarget.constraint = newConstraint;
                    Matter.World.add(this.world, newConstraint);
                }

                this.addAnimation('release', this.dragTarget);
            }
            
            // Hide delete indicator when drag ends
            this.hideDeleteIndicator();
        }

        if (this.rotationStartAngle !== null) {
            console.log('🔄 Resetting rotation variables');
        }
        this.rotationStartAngle = null;
        this.initialRotation = null;
        
        this.isDragging = false;
        this.isRotating = false;
        
        // Reset opacity when drag ends, but only if no popover is present
        if (this.dragTarget && this.dragTarget.deleteHoverOpacity !== undefined && !this.deletePopover) {
            delete this.dragTarget.deleteHoverOpacity;
        }
        
        this.dragTarget = null;
        
        console.log('✅ Mouse up complete - all states reset');
    }

    // Ensure the current dragTarget remains inside the fixed play area, if possible
    clampDragTargetInsideBounds() {
        if (!this.dragTarget || !this.dragTarget.body) return;
        const body = this.dragTarget.body;
        const b = body.bounds;
        let dx = 0, dy = 0;
        if (b.min.x < 0) dx = Math.max(dx, - (b.min.x - 1));
        if (b.max.x > this.gameWidth) dx = Math.min(dx, this.gameWidth - b.max.x - 1);
        if (b.min.y < 0) dy = Math.max(dy, - (b.min.y - 1));
        if (b.max.y > this.gameHeight) dy = Math.min(dy, this.gameHeight - b.max.y - 1);
        if (dx !== 0 || dy !== 0) {
            Matter.Body.translate(body, { x: dx, y: dy });
        }
    }

    // End any active drag/rotate operation due to boundary sensor contact
    cancelInteractionDueToBoundary() {
        if (!this.isDragging && !this.isRotating) return;
        // Nudge inside if out of bounds
        this.clampDragTargetInsideBounds();
        
        if (this.dragTarget) {
            // Re-add spring for text if applicable (mirrors mouseup behavior)
            if (this.isDragging && this.dragTarget.isText) {
                const { body } = this.dragTarget;
                const newConstraint = Matter.Constraint.create({
                    pointA: { x: body.position.x, y: body.position.y },
                    bodyB: body,
                    stiffness: 0.02,
                    damping: 0.07
                });
                this.dragTarget.constraint = newConstraint;
                Matter.World.add(this.world, newConstraint);
            }
            this.addAnimation('release', this.dragTarget);
        }

        this.rotationStartAngle = null;
        this.initialRotation = null;
        this.isDragging = false;
        this.isRotating = false;
        this.dragTarget = null;
        this.canvas.style.cursor = 'default';
    }
    
    isPointInObject(mouseX, mouseY, obj) {
        if (obj.body && obj.body.vertices) {
            return Matter.Vertices.contains(obj.body.vertices, { x: mouseX, y: mouseY });
        }
        return false;
    }
    
    saveSceneLayout() {
        const layout = {
            objects: this.gameObjects
                .filter(obj => obj.text !== 'marble') // Don't save marbles
                .map(obj => ({
                    name: obj.text,
                    x: obj.body.position.x,
                    y: obj.body.position.y,
                    rotation: obj.body.angle,
                    scale: obj.imageScale || 1.0,
                    isStatic: obj.body.isStatic,
                    specialProperties: {
                        isBoing: obj.isBoing || false,
                        isWastebasket: obj.isWastebasket || false,
                        isCup: obj.isCup || false
                    }
                })),
            canvasSize: {
                width: this.gameWidth,
                height: this.gameHeight
            },
            timestamp: new Date().toISOString()
        };
        
        console.log('=== SCENE LAYOUT FOR sceneLayout.json ===');
        console.log(JSON.stringify(layout, null, 2));
        console.log('=== Copy the above JSON to public/sceneLayout.json ===');
        
        // Show user feedback
        const statusEl = document.getElementById('status');
        if (statusEl) {
            statusEl.textContent = 'Scene layout saved to console! Copy JSON to sceneLayout.json';
            setTimeout(() => {
                statusEl.textContent = 'Drag text to interact.';
            }, 3000);
        }
    }
    
    async loadSceneLayout() {
        try {
            const response = await fetch('./sceneLayout.json');
            if (!response.ok) {
                console.log('No sceneLayout.json found, using default layout');
                this.createDefaultScene();
                return;
            }
            
            const layout = await response.json();
            console.log('Loading scene layout from sceneLayout.json');
            
            // Load objects from layout
            for (const objData of layout.objects) {
                if (objData.specialProperties.isCup) {
                    this.imageCupObj = this.createImageCupAt(objData.x, objData.y);
                } else if (objData.specialProperties.isWastebasket) {
                    this.imageWastebasketObj = this.createImageWastebasketAt(objData.x, objData.y);
                } else {
                    const obj = this.addCachedImageObject(
                        objData.name.toLowerCase(), 
                        objData.x, 
                        objData.y, 
                        { 
                            scale: objData.scale, 
                            rotation: objData.rotation 
                        }
                    );
                    
                    // Apply special properties
                    if (objData.specialProperties.isBoing && obj) {
                        obj.isBoing = true;
                        obj.body.restitution = 1.3;
                        console.log('✅ Boing object loaded with special properties:', obj.text, 'restitution:', obj.body.restitution);
                    }
                }
            }
            
            // Position the input form relative to the cup
            const cupBottomY = this.imageCupObj ? this.imageCupObj.body.position.y + this.imageCupObj.height / 2 : this.gameHeight * 0.9;
            const formContainer = document.querySelector('.input-container');
            if (formContainer) {
                // Add 80px offset to move the form higher
                formContainer.style.bottom = `${this.gameHeight - cupBottomY + 80}px`;
            }

            // Start with a single marble
            this.spawnMultipleMarbles(1);
            
        } catch (error) {
            console.log('Error loading scene layout:', error);
            this.createDefaultScene();
        }
    }
    
    createDefaultScene() {
        // Your current scene creation logic
        const w = this.gameWidth;
        const h = this.gameHeight;
        
        // Place objects with scale 1.0
        const arduino = this.addCachedImageObject('arduino', w * 0.15, h * 0.3, { scale: 1.0, rotation: 0.2 });
        const banana = this.addCachedImageObject('banana', w * 0.5, h * 0.55, { scale: 1.0, rotation: 0.2 });
        const boing = this.addCachedImageObject('boing', w * 0.8, h * 0.25, { scale: 1.0, rotation: 0.1 });
        // Mark boing as special bouncy object
        if (boing) {
            boing.isBoing = true;
            boing.body.restitution = 1.3; // Super bouncy
        }
        const eprom = this.addCachedImageObject('eprom', w * 0.2, h * 0.5, { scale: 1.0, rotation: -0.8 });
        const hotgluegun = this.addCachedImageObject('hotgluegun', w * 0.65, h * 0.4, { scale: 1.0, rotation: 0.3 });
        const pencil = this.addCachedImageObject('pencil', w * 0.4, h * 0.75, { scale: 1.0, rotation: 0.3 });
        const ribbon = this.addCachedImageObject('ribbon_cable_2', w * 0.75, h * 0.6, { scale: 1.0, rotation: 0 });
        const ruler = this.addCachedImageObject('ruler', w * 0.3, h * 0.35, { scale: 1.0, rotation: 0.5 });
        const skateboard = this.addCachedImageObject('skateboard', w * 0.6, h * 0.7, { scale: 1.0, rotation: -0.2 });
        const slipon = this.addCachedImageObject('slipon', w * 0.85, h * 0.5, { scale: 1.0, rotation: 0.4 });
        const sunglasses = this.addCachedImageObject('sunglasses', w * 0.7, h * 0.3, { scale: 1.0, rotation: 0.1 });
        // Create wastebasket as static item opposite the cup
        this.imageWastebasketObj = this.createImageWastebasketAt(w * 0.15, h * 0.88);
        const wrench = this.addCachedImageObject('wrench', w * 0.9, h * 0.8, { scale: 1.0, rotation: 0.7 });
        
        // Create cup as static item
        this.imageCupObj = this.createImageCupAt(w * 0.85, h * 0.88);
        
        // Position the input form relative to the cup
        const cupBottomY = this.imageCupObj ? this.imageCupObj.body.position.y + this.imageCupObj.height / 2 : h * 0.9;
        const formContainer = document.querySelector('.input-container');
        if (formContainer) {
            // Add 80px offset to move the form higher
            formContainer.style.bottom = `${h - cupBottomY + 80}px`;
        }

        // Start with a single marble
        this.spawnMultipleMarbles(1);
    }
    
    
    handleCollisions(pairs) {
        for (const pair of pairs) {
            const { bodyA, bodyB } = pair;
            const objA = bodyA.gameObject;
            const objB = bodyB.gameObject;
            
            // Check if either body is the boing object
            if (objA?.isMarble || objB?.isMarble) {
                for (const obj of this.gameObjects) {
                    // Check main body and compound body parts
                    let isBodyMatch = false;
                    if (obj.body) {
                        // Check main body ID
                        if (obj.body.id === bodyA.id || obj.body.id === bodyB.id) {
                            isBodyMatch = true;
                        }
                        // Check compound body parts if it exists
                        if (obj.body.parts && obj.body.parts.length > 1) {
                            for (const part of obj.body.parts) {
                                if (part.id === bodyA.id || part.id === bodyB.id) {
                                    isBodyMatch = true;
                                    break;
                                }
                            }
                        }
                    }
                    
                    if (isBodyMatch && obj.text === 'BOING' && obj.isImage) {
                        const marbleObj = objA?.isMarble ? objA : objB;
                        
                        // Add rainbow trail effect to the boing object
                        this.addTextShockwave(obj);
                        
                        // Super bounce effect
                        if (marbleObj) {
                            const bounceFactor = 1.2;
                            const upwardBoost = -12;
                            
                            Matter.Body.setVelocity(marbleObj.body, {
                                x: marbleObj.body.velocity.x * bounceFactor,
                                y: upwardBoost
                            });
                            
                            document.getElementById('marbleStatus').textContent = 'BOING!';
                        }
                        break;
                    }
                }
            }
            
            // Marble hitting text
            if ((objA?.isMarble && objB?.isText) || (objA?.isText && objB?.isMarble)) {
                const marbleObj = objA?.isMarble ? objA : objB;
                const textObj = objA?.isText ? objA : objB;

                this.playLetterSound(textObj.text);
                document.getElementById('marbleStatus').textContent = `Hit ${textObj.text}!`;
                this.addTextShockwave(textObj);

                const now = Date.now();
                // Use a shorter cooldown for "MAKING" to allow for two quick bounces, matching its syllables.
                const cooldown = (textObj.text === 'MAKING') ? 250 : 500;

                if (now - textObj.lastBounceTime > cooldown) {
                    textObj.lastBounceTime = now;

                    // The sentence angle is now flatter (0.1), so we adjust the bounce physics.
                    const sentenceAngle = textObj.body.angle;
                    const bounceAngle = sentenceAngle - Math.PI / 2;

                    const forwardVector = { x: Math.cos(sentenceAngle), y: Math.sin(sentenceAngle) };
                    const bounceVector = { x: Math.cos(bounceAngle), y: Math.sin(bounceAngle) };

                    // Fine-tuned speeds for the flatter angle to create a nice hop.
                    const bounceSpeed = 4;   // Reduced vertical pop for more subtle bounces.
                    const forwardSpeed = 5;  // Increased forward push to help marbles clear words better.

                    const finalVelocity = {
                        x: bounceVector.x * bounceSpeed + forwardVector.x * forwardSpeed,
                        y: bounceVector.y * bounceSpeed + forwardVector.y * forwardSpeed
                    };

                    Matter.Body.setVelocity(marbleObj.body, finalVelocity);
                }
            }
            
            // Marble hitting boing object - special bouncy behavior with rainbow trail
            if ((objA?.isMarble && objB?.isImage && objB?.text === 'BOING') || 
                (objA?.isImage && objA?.text === 'BOING' && objB?.isMarble)) {
                const marbleObj = objA?.isMarble ? objA : objB;
                const boingObj = (objA?.isImage && objA?.text === 'BOING') ? objA : objB;
                
                console.log('🎯 BOING collision detected!', boingObj);
                
                // Add rainbow trail effect to the boing object
                this.addTextShockwave(boingObj);
                
                // Super bounce effect - apply immediate velocity change
                const bounceFactor = 3.0;
                const upwardBoost = -15; // Strong upward velocity
                
                Matter.Body.setVelocity(marbleObj.body, {
                    x: marbleObj.body.velocity.x * bounceFactor,
                    y: upwardBoost // Direct upward velocity
                });
                
                document.getElementById('marbleStatus').textContent = 'BOING!';
            }
            
            // Marble hitting only the cup's top sensor (not the cup sides)
            if ((objA?.isMarble && objB?.isCupTopSensor) || (objA?.isCupTopSensor && objB?.isMarble)) {
                const marbleObj = objA?.isMarble ? objA : objB;
                this.marbleInCup(marbleObj);
            }

            // Drag target touching boundary sensors -> immediately cancel the interaction
            if (this.isDragging || this.isRotating) {
                const aIsBoundary = objA?.isBoundarySensor === true;
                const bIsBoundary = objB?.isBoundarySensor === true;
                if (aIsBoundary || bIsBoundary) {
                    const otherObj = aIsBoundary ? objB : objA;
                    if (otherObj && this.dragTarget && otherObj === this.dragTarget) {
                        this.cancelInteractionDueToBoundary();
                    }
                }
            }
        }
    }
    
    playLetterSound(text) {
        return; // Sound disabled for now
        if (!this.audioInitialized || !this.synth) return;
        
        // Play different notes for different letters
        const notes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'];
        const noteIndex = text.charCodeAt(0) % notes.length;
        
        this.synth.triggerAttackRelease(notes[noteIndex], '8n');
    }
    
    marbleInCup(marbleObj) {
        // If game already over, ignore further cup hits
        if (this.gameOver) return;

        // First success triggers final release
        if (this.phase === 'single') {
            this.score += 10;
            const scoreEl = document.getElementById('score');
            if (scoreEl) scoreEl.textContent = this.score;
            const statusEl = document.getElementById('marbleStatus');
            if (statusEl) statusEl.textContent = 'Releasing 10 marbles... Game Over';

            // Play success sound
            const audio = new Audio('./audio/ball_in_cup.mp3');
            audio.play().catch(e => console.log('Audio play failed:', e));

            // Remove the scoring marble
            if (marbleObj && marbleObj.body) {
                Matter.World.remove(this.world, marbleObj.body);
                this.marbles = this.marbles.filter(m => m !== marbleObj);
            }

            // Create rainbow confetti effect from cup
            this.createConfettiEffect();
            this.phase = 'final';
            this.gameOver = true;
            this.targetMarbleCount = 0; // disable maintenance respawns
            return;
        }

        // Any other phases: do nothing
    }
    
    createConfettiEffect() {
        if (!this.imageCupObj) return;
        
        // Initialize confetti array if it doesn't exist
        if (!this.confetti) {
            this.confetti = [];
        }
        
        const cupX = this.imageCupObj.x;
        const cupY = this.imageCupObj.y - this.imageCupObj.height / 2 + 20;
        const colors = [
            '#E74C3C', '#E67E22', '#F39C12', '#F1C40F', '#F7DC6F', 
            '#82E5AA', '#58D68D', '#48C9B0', '#5DADE2', '#5499C7',
            '#EC7063', '#EB984E', '#F8C471', '#F4D03F', '#ABEBC6',
            '#7FB3D3', '#85C1E9', '#AED6F1', '#D5DBDB', '#BDC3C7'
        ];
        
        // Create 30 confetti pieces
        for (let i = 0; i < 30; i++) {
            this.confetti.push({
                x: cupX + (Math.random() - 0.5) * 20,
                y: cupY,
                vx: (Math.random() - 0.5) * 8,
                vy: -Math.random() * 8 - 5, // shoot upward
                color: colors[Math.floor(Math.random() * colors.length)],
                size: Math.random() * 8 + 6, // larger size: 6-14px instead of 2-6px
                rotation: Math.random() * Math.PI * 2,
                rotationSpeed: (Math.random() - 0.5) * 0.3,
                gravity: 0.2,
                life: 1.0,
                decay: 0.008
            });
        }
    }
    
    updateConfetti() {
        if (!this.confetti) return;
        
        for (let i = this.confetti.length - 1; i >= 0; i--) {
            const particle = this.confetti[i];
            
            // Update position
            particle.x += particle.vx;
            particle.y += particle.vy;
            particle.vy += particle.gravity;
            particle.rotation += particle.rotationSpeed;
            
            // Fade out
            particle.life -= particle.decay;
            
            // Remove if off screen or faded
            if (particle.life <= 0 || particle.y > this.canvas.height + 50) {
                this.confetti.splice(i, 1);
            }
        }
    }
    
    drawConfetti() {
        if (!this.confetti) return;
        
        for (const particle of this.confetti) {
            this.ctx.save();
            this.ctx.translate(particle.x, particle.y);
            this.ctx.rotate(particle.rotation);
            this.ctx.globalAlpha = particle.life;
            this.ctx.fillStyle = particle.color;
            this.ctx.fillRect(-particle.size/2, -particle.size/2, particle.size, particle.size);
            this.ctx.restore();
        }
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
            await this.addImageObject(nameFromUrl, url, { x, y, scale: 1, tolerance: this.whiteToAlphaTolerance, isStatic: true });
            return;
        }
        
        // Quick keywords for built-in images
        if (lowerDesc.includes('pencil') && this.imageCache.has('pencil')) {
            await this.addImageObject('pencil', './images/pencil.png', { x, y, scale: 1, tolerance: this.whiteToAlphaTolerance, isStatic: true });
            return;
        }
        if (lowerDesc.includes('banana') && this.imageCache.has('banana')) {
            // Use runtime white→alpha processing and accurate collision
            await this.addImageObject('banana', './images/banana.png', { x, y, scale: 1, tolerance: this.whiteToAlphaTolerance, isStatic: true });
            return;
        }

        // Try LLM image generation via backend
        try {
            // Add system instruction for white background
            const enhancedPrompt = `Please make a product photo on a #ffffff background with no shadows of the item listed:

${description}`;
            
            const res = await fetch('/api/generate-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: enhancedPrompt, size: '1024x1024' })
            });
            if (!res.ok) {
                // Read error body for diagnostics
                let errText = '';
                try { errText = await res.text(); } catch (_) {}
                console.warn('Image API error', res.status, errText);
                throw new Error(`Image API ${res.status}: ${errText || 'Unknown error'}`);
            }

            const data = await res.json();
            if (data && data.imageUrl) {
                const name = `gen_${Date.now()}`;
                await this.addImageObject(name, data.imageUrl, { x, y, scale: 0.25, tolerance: this.whiteToAlphaTolerance, isStatic: true });
                document.getElementById('status').textContent = 'Created via AI image';
                return;
            }
            throw new Error('Image API returned OK but no imageUrl field');
        } catch (err) {
            console.warn('AI image generation failed, falling back to text', err);
            const statusEl = document.getElementById('status');
            if (statusEl) statusEl.textContent = `AI gen failed: ${err?.message || err}`;
        }

        // Fallback: Create a static text object
        {
            const color = `hsl(${Math.random() * 360}, 70%, 50%)`;
            this.ctx.font = 'bold 24px "Passion One"';
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
            friction: 0.02,
            frictionStatic: 0.01
        });
        obj.body = body;
        body.gameObject = obj;
        this.gameObjects.push(obj);
        Matter.World.add(this.world, body);
    }
    
    update() {
        // Update physics
        Matter.Engine.update(this.engine);

        // Update object histories for trails
        for (const obj of this.gameObjects) {
            if (obj.isText && obj.body && obj.history) {
                obj.history.unshift({ x: obj.body.position.x, y: obj.body.position.y, angle: obj.body.angle });
                if (obj.history.length > 4) { // Keep trail length manageable
                    obj.history.pop();
                }
            }
        }

        // Update animations
        this.updateAnimations();
        this.updateTextEffects();
        // Update confetti particles
        this.updateConfetti();
        // Off-screen cleanup and respawn maintenance
        this.checkMarblesOffScreen();
    }

    addAnimation(type, object, duration = 300) {
        this.animations = this.animations.filter(anim => anim.object !== object);
        this.animations.push({
            type,
            object,
            duration,
            startTime: Date.now(),
            startScale: object.displayScale || 1.0,
        });
    }

    addTextShockwave(textObj) {
        this.textEffects.push({
            obj: textObj,
            startTime: Date.now(),
            duration: 800, // ms
            trailCount: 7,
        });
    }

    updateTextEffects() {
        const now = Date.now();
        this.textEffects = this.textEffects.filter(effect => {
            const elapsed = now - effect.startTime;
            return elapsed < effect.duration;
        });
    }

    updateAnimations() {
        const now = Date.now();
        this.animations = this.animations.filter(anim => {
            const elapsed = now - anim.startTime;
            const progress = Math.min(elapsed / anim.duration, 1);
            const object = anim.object;

            if (anim.type === 'pluck') {
                let scale;
                const peakTime = 0.4;
                if (progress < peakTime) {
                    scale = 1.0 + 0.2 * (progress / peakTime);
                } else {
                    scale = 1.2 - 0.1 * ((progress - peakTime) / (1 - peakTime));
                }
                object.displayScale = scale;
                if (progress >= 1) object.displayScale = 1.1;

            } else if (anim.type === 'release') {
                const startScale = anim.startScale;
                const diff = startScale - 1.0;
                // A spring-like decay function
                const p = progress * 6; // Speed of oscillation
                const scale = 1.0 + diff * Math.exp(-p * 0.5) * Math.cos(p);
                object.displayScale = scale;
                if (progress >= 1) object.displayScale = 1.0;
            }

            return progress < 1;
        });
    }
    
    render() {
        // Clear canvas
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Draw text effects (rainbow trails)
        this.drawTextEffects();

        // Draw static background objects first (wastebasket, cup)
        for (const obj of this.gameObjects) {
            if (obj.isWastebasket || obj.isCup) {
                this.ctx.save();
                this.renderObject(obj);
                this.ctx.restore();
            }
        }
        
        // Draw all other game objects on top
        for (const obj of this.gameObjects) {
            if (!obj.isWastebasket && !obj.isCup) {
                this.ctx.save();
                this.renderObject(obj);
                this.ctx.restore();
            }
        }
        
        // Draw delete indicator if visible
        if (this.deleteIndicator && this.deleteIndicator.visible) {
            this.ctx.save();
            
            // Set up text metrics for box sizing
            this.ctx.font = `bold ${this.deleteIndicator.fontSize}px Arial`;
            const textMetrics = this.ctx.measureText(this.deleteIndicator.text);
            const textWidth = textMetrics.width;
            const textHeight = this.deleteIndicator.fontSize;
            
            // Box dimensions with padding
            const padding = 8;
            const boxWidth = textWidth + (padding * 2);
            const boxHeight = textHeight + (padding * 2);
            const boxX = this.deleteIndicator.x - boxWidth / 2;
            const boxY = this.deleteIndicator.y - boxHeight / 2;
            
            // Draw drop shadow
            this.ctx.fillStyle = 'rgba(0,0,0,0.3)';
            this.ctx.fillRect(boxX + 2, boxY + 2, boxWidth, boxHeight);
            
            // Draw white background box
            this.ctx.fillStyle = 'white';
            this.ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
            
            // Draw border
            this.ctx.strokeStyle = '#ccc';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
            
            // Draw text
            this.ctx.textAlign = 'center';
            this.ctx.textBaseline = 'middle';
            this.ctx.fillStyle = this.deleteIndicator.color;
            this.ctx.fillText(this.deleteIndicator.text, this.deleteIndicator.x, this.deleteIndicator.y);
            
            this.ctx.restore();
        }
        
        // Draw marbles
        for (const m of this.marbles) {
            this.ctx.save();
            this.ctx.translate(m.body.position.x, m.body.position.y);
            this.ctx.fillStyle = m.color;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, m.radius, 0, Math.PI * 2);
            this.ctx.fill();
            // Marble highlight
            this.ctx.fillStyle = 'rgba(255,255,255,0.3)';
            this.ctx.beginPath();
            this.ctx.arc(-4, -4, m.radius * 0.3, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        }
        
        // Draw confetti on top of everything
        this.drawConfetti();
    }
    
    renderObject(obj) {
        if (obj.isText) {
                // Draw text
                // Draw trail from history
                const trailColors = ['#FF00FF', '#00FFFF', '#FFFF00'];
                const trailMultiplierY = 1.5;
                const trailMultiplierX = 0.5; // Less exaggeration on the x-axis
                const currentPos = obj.body.position;
                const currentAngle = obj.body.angle;

                for (let i = obj.history.length - 1; i > 0; i--) {
                    const historyEntry = obj.history[i];
                    const alpha = 1 - (i / obj.history.length);

                    const trailX = currentPos.x + (historyEntry.x - currentPos.x) * trailMultiplierX * (i + 1);
                    const trailY = currentPos.y + (historyEntry.y - currentPos.y) * trailMultiplierY * (i + 1);
                    const trailAngle = currentAngle + (historyEntry.angle - currentAngle) * trailMultiplierY * (i + 1);
                    
                    this.ctx.save();
                    this.ctx.translate(trailX, trailY);
                    this.ctx.rotate(trailAngle);
                    const scale = obj.displayScale || 1;
                    this.ctx.font = `bold ${obj.fontSize * scale}px "Passion One"`;
                    this.ctx.textAlign = 'center';
                    this.ctx.textBaseline = 'middle';
                    this.ctx.fillStyle = `${trailColors[i % trailColors.length]}${Math.round(alpha * 128).toString(16).padStart(2, '0')}`;
                    this.ctx.fillText(obj.text, 0, 0);
                    this.ctx.restore();
                }

                // Draw main text
                this.ctx.translate(obj.body.position.x, obj.body.position.y);
                this.ctx.rotate(obj.body.angle);
                const scale = obj.displayScale || 1;
                this.ctx.font = `bold ${obj.fontSize * scale}px "Passion One"`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillStyle = obj.color;
                this.ctx.fillText(obj.text, 0, 0);
            } else if (obj.image) {
                // Draw image
                this.ctx.translate(obj.body.position.x, obj.body.position.y);
                this.ctx.rotate(obj.body.angle);
                const scale = obj.displayScale || 1;
                const off = (obj.body && obj.body.renderOffset) ? obj.body.renderOffset : { x: 0, y: 0 };
                
                // Apply opacity if hovering over wastebasket during drag
                if (obj.deleteHoverOpacity !== undefined) {
                    this.ctx.globalAlpha = obj.deleteHoverOpacity;
                }
                
                this.ctx.drawImage(
                    obj.image,
                    (-obj.width / 2 - off.x) * scale,
                    (-obj.height / 2 - off.y) * scale,
                    obj.width * scale,
                    obj.height * scale
                );
                
                // Reset opacity
                this.ctx.globalAlpha = 1.0;
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
    }
    
    drawTextEffects() {
        const now = Date.now();
        for (const effect of this.textEffects) {
            const elapsed = now - effect.startTime;
            const progress = elapsed / effect.duration;
            const obj = effect.obj;

            for (let i = 0; i < effect.trailCount; i++) {
                const trailProgress = (progress + (i / effect.trailCount) * 0.5) % 1;
                const alpha = Math.sin(trailProgress * Math.PI) * (1 - progress);
                if (alpha <= 0) continue;

                const hue = (now / 20 + i * 30) % 360;
                const color = `hsla(${hue}, 90%, 65%, ${alpha * 0.8})`;

                const offset = (i + 1) * 2.5 * (1 + progress * 5);
                const angle = (i / effect.trailCount) * Math.PI * 2;
                const x = obj.body.position.x + Math.cos(angle) * offset;
                const y = obj.body.position.y + Math.sin(angle) * offset;

                this.ctx.save();
                this.ctx.translate(x, y);
                this.ctx.rotate(obj.body.angle);
                const scale = obj.displayScale || 1;
                this.ctx.font = `bold ${obj.fontSize * scale}px \"Passion One\"`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                this.ctx.fillStyle = color;
                this.ctx.fillText(obj.text, 0, 0);
                this.ctx.restore();
            }
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

// Initialize game when the DOM is ready and the specific font has been loaded
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // Explicitly wait for the 'Passion One' font to be ready at the correct weight and size
        await document.fonts.load('bold 96px "Passion One"');
        console.log('✅ Passion One font loaded.');
        new MusicalMarbleDrop();
    } catch (error) {
        console.error('❌ Font failed to load, starting game with fallback font.', error);
        // Still start the game if the font fails, to prevent a total freeze
        new MusicalMarbleDrop();
    }
});
