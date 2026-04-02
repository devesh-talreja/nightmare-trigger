import * as THREE from 'three';

        // --- Setup Scene, Camera, Renderers ---
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a1030); // initial dark blue
        scene.fog = new THREE.FogExp2(0x0a1030, 0.025);

        const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 1000);
        camera.position.set(0, 1.65, 0);
        
        // Rotation state
        let yaw = -Math.PI / 4;
        let pitch = 0;
        const PITCH_LIMIT = Math.PI / 2.2;
        
        // Movement state
        const keyState = {
            ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false,
            w: false, s: false, a: false, d: false
        };
        const MOVE_SPEED = 4.0;
        const BOUNDS = 8.0;
        
        let isDragging = false;
        let lastMouseX = 0, lastMouseY = 0;
        let dragThreshold = 5;
        let hasMovedBeyondThreshold = false;
        let pointerStartX = 0, pointerStartY = 0;
        
        function updateCameraRotation() {
            const euler = new THREE.Euler(pitch, yaw, 0, 'YXZ');
            camera.quaternion.setFromEuler(euler);
        }
        updateCameraRotation();
        
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(renderer.domElement);

        // --- Lighting ---
        const ambientLight = new THREE.AmbientLight(0x221111);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(0xaa88ff, 1.2);
        dirLight.position.set(5, 10, 7);
        dirLight.castShadow = true;
        dirLight.receiveShadow = true;
        dirLight.shadow.mapSize.width = 1024;
        dirLight.shadow.mapSize.height = 1024;
        scene.add(dirLight);
        const backLight = new THREE.PointLight(0xaa2222, 0.5);
        backLight.position.set(-2, 2, -4);
        scene.add(backLight);
        const flickerLight = new THREE.PointLight(0xff3300, 0.8);
        flickerLight.position.set(1, 2, 2);
        scene.add(flickerLight);
        
        // Ground
        const groundPlane = new THREE.Mesh(
            new THREE.PlaneGeometry(20, 20),
            new THREE.MeshStandardMaterial({ color: 0x331111, roughness: 0.7, metalness: 0.1, side: THREE.DoubleSide })
        );
        groundPlane.rotation.x = -Math.PI / 2;
        groundPlane.position.y = -0.2;
        groundPlane.receiveShadow = true;
        scene.add(groundPlane);
        
        const gridHelper = new THREE.GridHelper(25, 20, 0x661111, 0x441111);
        gridHelper.position.y = -0.15;
        scene.add(gridHelper);
        
        // Particles
        const particleCount = 400;
        const particlesGeometry = new THREE.BufferGeometry();
        const particlePositions = new Float32Array(particleCount * 3);
        for (let i = 0; i < particleCount; i++) {
            particlePositions[i*3] = (Math.random() - 0.5) * 30;
            particlePositions[i*3+1] = Math.random() * 4;
            particlePositions[i*3+2] = (Math.random() - 0.5) * 20 - 5;
        }
        particlesGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
        const particleMaterial = new THREE.PointsMaterial({ color: 0xaa5555, size: 0.08, transparent: true, opacity: 0.5 });
        const particles = new THREE.Points(particlesGeometry, particleMaterial);
        scene.add(particles);
        
        // --- Game State ---
        let score = 0;
        let timeLeft = 120;
        let health = 100;
        let gameActive = true;
        let enemies = [];
        let arrows = [];
        let powerups = [];
        let spawnInterval = null;
        let timerInterval = null;
        let powerupSpawnInterval = null;
        
        const MAX_ENEMIES = 6;
        const MAX_ARCHERS = 3;
        const MAX_BATS = 3;
        const ENEMY_SPAWN_DELAY = 2.2;
        
        let baseEnemySpeed = 1.2;
        let speedProgressiveMultiplier = 1.0;
        let enemySpeedMultiplier = 1.0;
        let lastScoreMilestone = 0;
        
        let bossPresent = false;
        let lastBossThreshold = 0;
        let lastArcherThreshold = 0;
        let lastBatThreshold = 0;
        let lastBgThreshold = -1; // ensure first update triggers
        
        // Background color cycle (5 dark, distinct colors)
        const bgColors = [
            0x0a1030, // deep blue
            0x1a1030, // dark purple
            0x301010, // dark red
            0x103020, // dark green
            0x301a10  // dark orange
        ];
        
        // Highest score
        let highestScore = localStorage.getItem('nightmareHighScore') ? parseInt(localStorage.getItem('nightmareHighScore')) : 0;
        
        // Power-up timers
        let slowMotionEndTime = 0;
        let multiShotEndTime = 0;
        let slowMotionActive = false;
        let multiShotActive = false;
        
        // Audio
        let audioContext = null;
        let isAudioEnabled = false;
        let isMuted = false;
        const muteBtn = document.getElementById('muteBtn');
        
        // UI elements
        const scoreSpan = document.getElementById('scoreValue');
        const timerSpan = document.getElementById('timerValue');
        const healthFill = document.getElementById('healthFill');
        const gameOverPanel = document.getElementById('gameOverPanel');
        const finalScoreSpan = document.getElementById('finalScore');
        const highestScoreSpan = document.getElementById('highestScore');
        const restartBtn = document.getElementById('restartBtn');
        const powerupStatusDiv = document.getElementById('powerupStatus');
        
        function updateUI() {
            scoreSpan.innerText = score;
            timerSpan.innerText = Math.max(0, timeLeft);
            let healthPercent = Math.max(0, (health / 100) * 100);
            healthFill.style.width = `${healthPercent}%`;
            if (healthPercent < 30) healthFill.style.background = "#aa0000";
            else healthFill.style.background = "linear-gradient(90deg, #ff4444, #aa0000)";
        }
        
        function setStatusMessage(msg, duration = 2000) {
            powerupStatusDiv.innerText = msg;
            powerupStatusDiv.style.opacity = '1';
            setTimeout(() => {
                if (powerupStatusDiv.innerText === msg) powerupStatusDiv.style.opacity = '0';
            }, duration);
        }
        
        // --- Progressive Speed ---
        function updateProgressiveSpeed() {
            const milestone = Math.floor(score / 100);
            if (milestone > lastScoreMilestone) {
                lastScoreMilestone = milestone;
                speedProgressiveMultiplier = Math.min(2.0, 1.0 + milestone * 0.05);
                setStatusMessage(`⚠️ ENEMIES FASTER! (x${speedProgressiveMultiplier.toFixed(2)})`, 1500);
            }
        }
        
        // --- Background color change every 200 points ---
        function updateBackgroundColor() {
            const cycleIndex = Math.floor(score / 200) % bgColors.length;
            if (cycleIndex !== lastBgThreshold) {
                lastBgThreshold = cycleIndex;
                const newColor = bgColors[cycleIndex];
                scene.background.setHex(newColor);
                scene.fog.color.setHex(newColor);
                setStatusMessage(`🌑 REALM SHIFTS`, 1000);
            }
        }
        
        function getCurrentEnemySpeed() {
            return baseEnemySpeed * speedProgressiveMultiplier * enemySpeedMultiplier;
        }
        
        function getCurrentBossSpeed() {
            return baseEnemySpeed * speedProgressiveMultiplier * 0.85 * enemySpeedMultiplier;
        }
        
        function getCurrentBatSpeed() {
            return baseEnemySpeed * speedProgressiveMultiplier * 1.3 * enemySpeedMultiplier;
        }
        
        // --- Power-up ---
        function createPowerup(color, type, pos) {
            const geometry = new THREE.SphereGeometry(0.7, 24, 24);
            const material = new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.7 });
            const orb = new THREE.Mesh(geometry, material);
            orb.position.copy(pos);
            orb.userData = { type: type, floatY: pos.y };
            scene.add(orb);
            return orb;
        }
        
        function spawnPowerup() {
            if (!gameActive) return;
            const types = ['health', 'slow', 'multi'];
            const type = types[Math.floor(Math.random() * types.length)];
            let color;
            if (type === 'health') color = 0x44ff44;
            else if (type === 'slow') color = 0x3399ff;
            else color = 0xffaa33;
            
            const angle = Math.random() * Math.PI * 2;
            const radius = 4 + Math.random() * 5;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            const y = 0.5;
            const pos = new THREE.Vector3(x, y, z);
            const powerup = createPowerup(color, type, pos);
            powerups.push(powerup);
        }
        
        // --- Enemy models (unchanged) ---
        function createScaryEnemy(x, z, yPos = 1.2) {
            const group = new THREE.Group();
            const bodyGeo = new THREE.CylinderGeometry(0.55, 0.65, 1.2, 8);
            const bodyMat = new THREE.MeshStandardMaterial({ color: 0x3a1a1a, roughness: 0.4, metalness: 0.1, emissive: 0x220000 });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.castShadow = true;
            body.receiveShadow = true;
            body.position.y = 0;
            group.add(body);
            
            for (let i = 0; i < 5; i++) {
                const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 4), new THREE.MeshStandardMaterial({ color: 0x2c0f0f, emissive: 0x331100 }));
                spike.position.set(-0.3 + i * 0.15, 0.4, -0.5);
                spike.castShadow = true;
                group.add(spike);
            }
            
            const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 24), new THREE.MeshStandardMaterial({ color: 0x4a2020, roughness: 0.2, emissive: 0x1a0000 }));
            head.position.y = 0.85;
            head.castShadow = true;
            group.add(head);
            
            const jaw = new THREE.Group();
            for (let i = -0.3; i <= 0.3; i+=0.15) {
                const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 3), new THREE.MeshStandardMaterial({ color: 0xeeddcc, emissive: 0x442200 }));
                tooth.position.set(i, -0.15, 0.52);
                jaw.add(tooth);
            }
            for (let i = -0.25; i <= 0.25; i+=0.12) {
                const toothLow = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.2, 3), new THREE.MeshStandardMaterial({ color: 0xffddbb }));
                toothLow.position.set(i, -0.35, 0.5);
                jaw.add(toothLow);
            }
            group.add(jaw);
            
            const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff3300, emissiveIntensity: 0.9 });
            const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), eyeMat);
            leftEye.position.set(-0.22, 1.02, 0.58);
            const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 16), eyeMat);
            rightEye.position.set(0.22, 1.02, 0.58);
            group.add(leftEye, rightEye);
            
            const pupilMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
            const leftPupil = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12), pupilMat);
            leftPupil.position.set(-0.22, 0.98, 0.75);
            const rightPupil = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12), pupilMat);
            rightPupil.position.set(0.22, 0.98, 0.75);
            group.add(leftPupil, rightPupil);
            
            const hornGeo = new THREE.ConeGeometry(0.22, 0.65, 5);
            const hornMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, emissive: 0x220000 });
            const leftHorn = new THREE.Mesh(hornGeo, hornMat);
            leftHorn.position.set(-0.38, 1.32, 0.25);
            leftHorn.rotation.z = -0.3;
            leftHorn.rotation.x = -0.2;
            const rightHorn = new THREE.Mesh(hornGeo, hornMat);
            rightHorn.position.set(0.38, 1.32, 0.25);
            rightHorn.rotation.z = 0.3;
            rightHorn.rotation.x = -0.2;
            group.add(leftHorn, rightHorn);
            
            const tendrilMat = new THREE.MeshStandardMaterial({ color: 0x5a2a2a });
            for (let i = 0; i < 3; i++) {
                const tendril = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.4, 3), tendrilMat);
                tendril.position.set(-0.45 + i*0.45, 0.15, 0.65);
                group.add(tendril);
            }
            
            group.position.set(x, yPos, z);
            group.userData = { isEnemy: true, hp: 1, isBoss: false, isArcher: false, isBat: false, damage: 18, points: 10 };
            return group;
        }
        
        function createArcherEnemy(x, z, yPos = 1.2) {
            const group = new THREE.Group();
            const bodyGeo = new THREE.CylinderGeometry(0.5, 0.6, 1.2, 8);
            const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.4 });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.castShadow = true;
            body.position.y = 0.6;
            group.add(body);
            
            const headGeo = new THREE.SphereGeometry(0.4, 24, 24);
            const headMat = new THREE.MeshStandardMaterial({ color: 0xddbb99 });
            const head = new THREE.Mesh(headGeo, headMat);
            head.position.y = 1.2;
            group.add(head);
            
            const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
            const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), eyeMat);
            leftEye.position.set(-0.15, 1.28, 0.45);
            const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 16), eyeMat);
            rightEye.position.set(0.15, 1.28, 0.45);
            group.add(leftEye, rightEye);
            
            const hoodGeo = new THREE.ConeGeometry(0.55, 0.5, 8);
            const hoodMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
            const hood = new THREE.Mesh(hoodGeo, hoodMat);
            hood.position.y = 1.45;
            group.add(hood);
            
            const bowGeo = new THREE.TorusGeometry(0.6, 0.08, 16, 32, Math.PI);
            const bowMat = new THREE.MeshStandardMaterial({ color: 0xaa8866 });
            const bow = new THREE.Mesh(bowGeo, bowMat);
            bow.position.set(0.65, 0.9, 0.2);
            bow.rotation.z = 0.3;
            bow.rotation.x = 0.2;
            bow.rotation.y = -0.2;
            group.add(bow);
            
            const quiverGeo = new THREE.CylinderGeometry(0.2, 0.15, 0.8, 6);
            const quiverMat = new THREE.MeshStandardMaterial({ color: 0x8b5a2b });
            const quiver = new THREE.Mesh(quiverGeo, quiverMat);
            quiver.position.set(-0.45, 0.9, -0.3);
            quiver.rotation.x = 0.2;
            group.add(quiver);
            
            group.position.set(x, yPos, z);
            group.userData = { isEnemy: true, hp: 2, isBoss: false, isArcher: true, isBat: false, damage: 12, points: 15, lastShot: 0 };
            return group;
        }
        
        function createBossEnemy(x, z, yPos = 1.2) {
            const group = createScaryEnemy(x, z, yPos);
            group.scale.set(1.3, 1.3, 1.3);
            group.traverse(child => {
                if (child.isMesh && child.material) {
                    child.material.color.setHex(0x5a2a6a);
                    child.material.emissive.setHex(0x331133);
                }
            });
            const crownGeo = new THREE.CylinderGeometry(0.3, 0.5, 0.4, 4);
            const crownMat = new THREE.MeshStandardMaterial({ color: 0xaa44aa, emissive: 0x441144 });
            const crown = new THREE.Mesh(crownGeo, crownMat);
            crown.position.set(0, 1.4, 0);
            group.add(crown);
            group.userData = { isEnemy: true, hp: 6, isBoss: true, isArcher: false, isBat: false, damage: 30, points: 50 };
            return group;
        }
        
        function createBatEnemy(x, z, yPos = 1.5) {
            const group = new THREE.Group();
            const bodyGeo = new THREE.SphereGeometry(0.35, 16, 16);
            const bodyMat = new THREE.MeshStandardMaterial({ color: 0x442222, emissive: 0x220000 });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.castShadow = true;
            group.add(body);
            
            const wingGeo = new THREE.BoxGeometry(0.8, 0.1, 0.4);
            const wingMat = new THREE.MeshStandardMaterial({ color: 0x552222 });
            const leftWing = new THREE.Mesh(wingGeo, wingMat);
            leftWing.position.set(-0.5, 0.1, 0);
            leftWing.rotation.z = -0.5;
            const rightWing = new THREE.Mesh(wingGeo, wingMat);
            rightWing.position.set(0.5, 0.1, 0);
            rightWing.rotation.z = 0.5;
            group.add(leftWing, rightWing);
            
            const headGeo = new THREE.SphereGeometry(0.25, 16, 16);
            const headMat = new THREE.MeshStandardMaterial({ color: 0x331111 });
            const head = new THREE.Mesh(headGeo, headMat);
            head.position.set(0, 0.3, 0.35);
            group.add(head);
            
            const earGeo = new THREE.ConeGeometry(0.15, 0.3, 4);
            const earMat = new THREE.MeshStandardMaterial({ color: 0x331111 });
            const leftEar = new THREE.Mesh(earGeo, earMat);
            leftEar.position.set(-0.2, 0.55, 0.25);
            const rightEar = new THREE.Mesh(earGeo, earMat);
            rightEar.position.set(0.2, 0.55, 0.25);
            group.add(leftEar, rightEar);
            
            const eyeMat = new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0x441111 });
            const leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), eyeMat);
            leftEye.position.set(-0.12, 0.35, 0.55);
            const rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 8), eyeMat);
            rightEye.position.set(0.12, 0.35, 0.55);
            group.add(leftEye, rightEye);
            
            group.userData = { isEnemy: true, hp: 2, isBoss: false, isArcher: false, isBat: true, damage: 18, points: 10, wingAngle: 0 };
            group.position.set(x, yPos, z);
            return group;
        }
        
        // --- Spawning ---
        function spawnEnemy() {
            if (!gameActive) return;
            const meleeCount = enemies.filter(e => !e.userData.isArcher && !e.userData.isBoss && !e.userData.isBat).length;
            if (meleeCount >= MAX_ENEMIES) return;
            const angle = Math.random() * Math.PI * 2;
            const radius = 6 + Math.random() * 3.5;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            const enemy = createScaryEnemy(x, z, 1.1 + Math.random() * 0.4);
            scene.add(enemy);
            enemies.push(enemy);
        }
        
        function spawnArcher() {
            if (!gameActive) return;
            const archerCount = enemies.filter(e => e.userData.isArcher).length;
            if (archerCount >= MAX_ARCHERS) return;
            const angle = Math.random() * Math.PI * 2;
            const radius = 5 + Math.random() * 4;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            const archer = createArcherEnemy(x, z, 1.1);
            scene.add(archer);
            enemies.push(archer);
        }
        
        function spawnBat() {
            if (!gameActive) return;
            const batCount = enemies.filter(e => e.userData.isBat).length;
            if (batCount >= MAX_BATS) return;
            const angle = Math.random() * Math.PI * 2;
            const radius = 5 + Math.random() * 4;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            const bat = createBatEnemy(x, z, 1.5);
            scene.add(bat);
            enemies.push(bat);
        }
        
        function spawnBoss() {
            if (!gameActive) return;
            if (bossPresent) return;
            const angle = Math.random() * Math.PI * 2;
            const radius = 6 + Math.random() * 2;
            const x = Math.cos(angle) * radius;
            const z = Math.sin(angle) * radius;
            const boss = createBossEnemy(x, z, 1.1);
            scene.add(boss);
            enemies.push(boss);
            bossPresent = true;
            setStatusMessage("💀 A BOSS APPEARS! 💀", 3000);
        }
        
        function removeEnemy(enemy) {
            const idx = enemies.indexOf(enemy);
            if (idx !== -1) enemies.splice(idx, 1);
            scene.remove(enemy);
            if (enemy.userData.isBoss) bossPresent = false;
        }
        
        function damagePlayer(amount) {
            if (!gameActive) return;
            health = Math.max(0, health - amount);
            updateUI();
            if (health <= 0) endGame();
            document.body.style.backgroundColor = 'rgba(100,0,0,0.3)';
            setTimeout(() => document.body.style.backgroundColor = '', 150);
        }
        
        // --- Arrow projectile ---
        function shootArrow(from, targetPos) {
            if (!gameActive) return;
            const dir = new THREE.Vector3().subVectors(targetPos, from).normalize();
            const group = new THREE.Group();
            const shaftGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.5, 4);
            const shaftMat = new THREE.MeshStandardMaterial({ color: 0xaa8866 });
            const shaft = new THREE.Mesh(shaftGeo, shaftMat);
            shaft.rotation.x = Math.PI / 2;
            group.add(shaft);
            
            const tipGeo = new THREE.ConeGeometry(0.1, 0.2, 4);
            const tipMat = new THREE.MeshStandardMaterial({ color: 0xccaa88 });
            const tip = new THREE.Mesh(tipGeo, tipMat);
            tip.position.set(0, 0, 0.3);
            group.add(tip);
            
            const fletchGeo = new THREE.BoxGeometry(0.08, 0.02, 0.1);
            const fletchMat = new THREE.MeshStandardMaterial({ color: 0xaa8866 });
            const leftFletch = new THREE.Mesh(fletchGeo, fletchMat);
            leftFletch.position.set(-0.1, 0, -0.2);
            const rightFletch = new THREE.Mesh(fletchGeo, fletchMat);
            rightFletch.position.set(0.1, 0, -0.2);
            group.add(leftFletch, rightFletch);
            
            group.position.copy(from);
            group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
            scene.add(group);
            arrows.push({ mesh: group, direction: dir, speed: 12.0, damage: 12 });
        }
        
        // --- Milestone checks (called after score increases) ---
        function checkMilestones() {
            const archerThreshold = Math.floor(score / 120);
            if (archerThreshold > lastArcherThreshold) {
                lastArcherThreshold = archerThreshold;
                spawnArcher();
            }
            const batThreshold = Math.floor(score / 80);
            if (batThreshold > lastBatThreshold) {
                lastBatThreshold = batThreshold;
                spawnBat();
            }
            const bossThreshold = Math.floor(score / 100);
            if (bossThreshold > lastBossThreshold && !bossPresent) {
                lastBossThreshold = bossThreshold;
                spawnBoss();
            }
            updateProgressiveSpeed();
            updateBackgroundColor();
        }
        
        // --- Shooting (player) ---
        const raycaster = new THREE.Raycaster();
        const mouseCoords = new THREE.Vector2();
        
        function performShoot(clientX, clientY) {
            if (!gameActive) return;
            const rect = renderer.domElement.getBoundingClientRect();
            const x = ((clientX - rect.left) / rect.width) * 2 - 1;
            const y = -((clientY - rect.top) / rect.height) * 2 + 1;
            
            const shots = multiShotActive ? 3 : 1;
            const offsets = [0, -0.12, 0.12];
            let hitSomething = false;
            
            for (let s = 0; s < shots; s++) {
                const off = offsets[s];
                let rayX = x, rayY = y;
                if (shots > 1) {
                    const angle = Math.atan2(y, x);
                    const radius = Math.hypot(x, y);
                    rayX = Math.cos(angle + off) * radius;
                    rayY = Math.sin(angle + off) * radius;
                }
                mouseCoords.set(rayX, rayY);
                raycaster.setFromCamera(mouseCoords, camera);
                const enemyMeshes = [];
                enemies.forEach(enemy => {
                    enemy.children.forEach(child => { if (child.isMesh) enemyMeshes.push(child); });
                });
                const intersects = raycaster.intersectObjects(enemyMeshes);
                if (intersects.length > 0) {
                    let hitObj = intersects[0].object;
                    while (hitObj.parent && !hitObj.userData?.isEnemy) hitObj = hitObj.parent;
                    if (hitObj.userData?.isEnemy) {
                        hitSomething = true;
                        const enemy = hitObj;
                        enemy.userData.hp -= 1;
                        if (enemy.userData.hp <= 0) {
                            score += enemy.userData.points;
                            updateUI();
                            checkMilestones();
                            removeEnemy(enemy);
                            const pos = enemy.position.clone();
                            for (let i = 0; i < 12; i++) {
                                const splat = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4), new THREE.MeshStandardMaterial({ color: 0xaa2222, emissive: 0x441111 }));
                                splat.position.copy(pos);
                                scene.add(splat);
                                setTimeout(() => scene.remove(splat), 400);
                            }
                        } else {
                            const flash = new THREE.PointLight(0xffaa66, 0.8, 4);
                            flash.position.copy(enemy.position);
                            scene.add(flash);
                            setTimeout(() => scene.remove(flash), 100);
                        }
                        break;
                    }
                }
            }
            
            if (hitSomething) {
                playGunshot();
                showHitMarker(clientX, clientY);
            }
            
            const muzzleFlash = new THREE.PointLight(0xffaa66, 1.5, 8);
            muzzleFlash.position.copy(camera.position);
            scene.add(muzzleFlash);
            setTimeout(() => scene.remove(muzzleFlash), 80);
            
            const flashDiv = document.createElement('div');
            flashDiv.style.position = 'absolute';
            flashDiv.style.top = '50%';
            flashDiv.style.left = '50%';
            flashDiv.style.width = '40px';
            flashDiv.style.height = '40px';
            flashDiv.style.transform = 'translate(-50%, -50%)';
            flashDiv.style.borderRadius = '50%';
            flashDiv.style.backgroundColor = 'rgba(255, 200, 100, 0.5)';
            flashDiv.style.pointerEvents = 'none';
            flashDiv.style.zIndex = '15';
            document.body.appendChild(flashDiv);
            setTimeout(() => flashDiv.remove(), 50);
        }
        
        function playGunshot() {
            if (!isAudioEnabled || isMuted) return;
            if (!audioContext) return;
            const now = audioContext.currentTime;
            const osc = audioContext.createOscillator();
            osc.type = 'triangle';
            osc.frequency.value = 800;
            const gain = audioContext.createGain();
            gain.gain.value = 0.2;
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
            osc.connect(gain);
            gain.connect(audioContext.destination);
            osc.start();
            osc.stop(now + 0.1);
        }
        
        function showHitMarker(clientX, clientY) {
            const div = document.createElement('div');
            div.className = 'hit-marker';
            div.textContent = 'HIT!';
            div.style.left = clientX + 'px';
            div.style.top = clientY + 'px';
            document.body.appendChild(div);
            setTimeout(() => div.remove(), 300);
        }
        
        // --- Drag & Shoot ---
        function shootAt(event) {
            if (!gameActive) return;
            let clientX, clientY;
            if (event.touches) {
                clientX = event.touches[0].clientX;
                clientY = event.touches[0].clientY;
                event.preventDefault();
            } else {
                clientX = event.clientX;
                clientY = event.clientY;
            }
            performShoot(clientX, clientY);
        }
        
        function onPointerDown(event) {
            if (!gameActive) return;
            isDragging = true;
            hasMovedBeyondThreshold = false;
            let clientX, clientY;
            if (event.touches) {
                clientX = event.touches[0].clientX;
                clientY = event.touches[0].clientY;
                event.preventDefault();
            } else {
                clientX = event.clientX;
                clientY = event.clientY;
            }
            pointerStartX = clientX;
            pointerStartY = clientY;
            lastMouseX = clientX;
            lastMouseY = clientY;
        }
        
        function onPointerMove(event) {
            if (!isDragging || !gameActive) return;
            let clientX, clientY;
            if (event.touches) {
                clientX = event.touches[0].clientX;
                clientY = event.touches[0].clientY;
                event.preventDefault();
            } else {
                clientX = event.clientX;
                clientY = event.clientY;
            }
            const dx = clientX - lastMouseX;
            const dy = clientY - lastMouseY;
            const moveDist = Math.hypot(clientX - pointerStartX, clientY - pointerStartY);
            if (moveDist > dragThreshold) hasMovedBeyondThreshold = true;
            if (dx !== 0 || dy !== 0) {
                yaw -= dx * 0.008;
                pitch -= dy * 0.008;
                pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
                updateCameraRotation();
                lastMouseX = clientX;
                lastMouseY = clientY;
            }
        }
        
        function onPointerUp(event) {
            if (!isDragging) return;
            isDragging = false;
            if (!hasMovedBeyondThreshold && gameActive) {
                shootAt(event);
            }
        }
        
        // --- Keyboard Movement ---
        function handleKeyDown(e) {
            const key = e.key;
            if (key === 'w' || key === 'W') keyState.w = true;
            if (key === 's' || key === 'S') keyState.s = true;
            if (key === 'a' || key === 'A') keyState.a = true;
            if (key === 'd' || key === 'D') keyState.d = true;
            if (key === 'ArrowUp') keyState.ArrowUp = true;
            if (key === 'ArrowDown') keyState.ArrowDown = true;
            if (key === 'ArrowLeft') keyState.ArrowLeft = true;
            if (key === 'ArrowRight') keyState.ArrowRight = true;
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'W', 's', 'S', 'a', 'A', 'd', 'D'].includes(key)) {
                e.preventDefault();
            }
        }
        
        function handleKeyUp(e) {
            const key = e.key;
            if (key === 'w' || key === 'W') keyState.w = false;
            if (key === 's' || key === 'S') keyState.s = false;
            if (key === 'a' || key === 'A') keyState.a = false;
            if (key === 'd' || key === 'D') keyState.d = false;
            if (key === 'ArrowUp') keyState.ArrowUp = false;
            if (key === 'ArrowDown') keyState.ArrowDown = false;
            if (key === 'ArrowLeft') keyState.ArrowLeft = false;
            if (key === 'ArrowRight') keyState.ArrowRight = false;
        }
        
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        
        function updatePlayerMovement(deltaTime) {
            if (!gameActive) return;
            const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
            const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
            forward.y = 0;
            right.y = 0;
            forward.normalize();
            right.normalize();
            let move = new THREE.Vector3(0, 0, 0);
            let up = keyState.w || keyState.ArrowUp;
            let down = keyState.s || keyState.ArrowDown;
            let left = keyState.a || keyState.ArrowLeft;
            let rightKey = keyState.d || keyState.ArrowRight;
            if (up) move.add(forward);
            if (down) move.sub(forward);
            if (left) move.sub(right);
            if (rightKey) move.add(right);
            if (move.length() > 0) move.normalize();
            move.multiplyScalar(MOVE_SPEED * deltaTime);
            let newX = camera.position.x + move.x;
            let newZ = camera.position.z + move.z;
            newX = Math.max(-BOUNDS, Math.min(BOUNDS, newX));
            newZ = Math.max(-BOUNDS, Math.min(BOUNDS, newZ));
            camera.position.x = newX;
            camera.position.z = newZ;
            camera.position.y = 1.65;
        }
        
        // --- Archer & Bat updates ---
        function updateArchers(deltaTime) {
            const now = Date.now() / 1000;
            for (let enemy of enemies) {
                if (enemy.userData.isArcher) {
                    const dirToPlayer = new THREE.Vector3().subVectors(camera.position, enemy.position).normalize();
                    const angle = Math.atan2(dirToPlayer.x, dirToPlayer.z);
                    enemy.rotation.y = angle;
                    if (!enemy.userData.lastShot) enemy.userData.lastShot = now;
                    if (now - enemy.userData.lastShot >= 1.0) {
                        enemy.userData.lastShot = now;
                        shootArrow(enemy.position.clone().add(new THREE.Vector3(0, 1.2, 0)), camera.position);
                    }
                }
                if (enemy.userData.isBat) {
                    enemy.userData.wingAngle = (enemy.userData.wingAngle || 0) + deltaTime * 8;
                    const wingAngle = Math.sin(enemy.userData.wingAngle) * 0.8;
                    const leftWing = enemy.children.find(c => c.position.x === -0.5);
                    const rightWing = enemy.children.find(c => c.position.x === 0.5);
                    if (leftWing) leftWing.rotation.z = -0.5 + wingAngle * 0.6;
                    if (rightWing) rightWing.rotation.z = 0.5 - wingAngle * 0.6;
                }
            }
        }
        
        function updateArrows(deltaTime) {
            for (let i = 0; i < arrows.length; i++) {
                const arrow = arrows[i];
                arrow.mesh.position.x += arrow.direction.x * arrow.speed * deltaTime;
                arrow.mesh.position.z += arrow.direction.z * arrow.speed * deltaTime;
                arrow.mesh.position.y += arrow.direction.y * arrow.speed * deltaTime;
                if (arrow.mesh.position.distanceTo(camera.position) < 0.8) {
                    damagePlayer(arrow.damage);
                    scene.remove(arrow.mesh);
                    arrows.splice(i, 1);
                    i--;
                    continue;
                }
                if (Math.abs(arrow.mesh.position.x) > 15 || Math.abs(arrow.mesh.position.z) > 15 || arrow.mesh.position.y > 5 || arrow.mesh.position.y < -1) {
                    scene.remove(arrow.mesh);
                    arrows.splice(i, 1);
                    i--;
                }
            }
        }
        
        // --- Audio init ---
        function initAudio() {
            if (audioContext) return;
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            isAudioEnabled = true;
        }
        
        function toggleMute() {
            isMuted = !isMuted;
            muteBtn.innerText = isMuted ? '🔇' : '🔊';
        }
        
        muteBtn.addEventListener('click', () => {
            if (!audioContext) initAudio();
            toggleMute();
        });
        
        function enableAudioOnFirstInteraction() {
            if (!audioContext) {
                initAudio();
                audioContext.resume();
            }
        }
        
        // Wrap event handlers
        const originalShoot = shootAt;
        function wrappedShoot(e) { enableAudioOnFirstInteraction(); originalShoot(e); }
        function wrappedPointerDown(e) { enableAudioOnFirstInteraction(); onPointerDown(e); }
        
        const canvas = renderer.domElement;
        canvas.removeEventListener('mousedown', onPointerDown);
        canvas.removeEventListener('touchstart', onPointerDown);
        canvas.addEventListener('mousedown', wrappedPointerDown);
        canvas.addEventListener('touchstart', wrappedPointerDown, { passive: false });
        window.addEventListener('mouseup', onPointerUp);
        window.addEventListener('mousemove', onPointerMove);
        window.addEventListener('touchmove', onPointerMove, { passive: false });
        window.addEventListener('touchend', onPointerUp);
        
        // --- Game Timer & End ---
        function startTimer() {
            if (timerInterval) clearInterval(timerInterval);
            timerInterval = setInterval(() => {
                if (!gameActive) return;
                if (timeLeft <= 0) {
                    clearInterval(timerInterval);
                    timerInterval = null;
                    endGame();
                } else {
                    timeLeft--;
                    updateUI();
                    if (timeLeft <= 10) timerSpan.style.color = "#ff6666";
                }
            }, 1000);
        }
        
        function endGame() {
            if (!gameActive) return;
            gameActive = false;
            if (timerInterval) clearInterval(timerInterval);
            if (spawnInterval) clearInterval(spawnInterval);
            if (powerupSpawnInterval) clearInterval(powerupSpawnInterval);
            timerInterval = null;
            spawnInterval = null;
            powerupSpawnInterval = null;
            
            // Update highest score
            if (score > highestScore) {
                highestScore = score;
                localStorage.setItem('nightmareHighScore', highestScore);
            }
            finalScoreSpan.innerText = score;
            highestScoreSpan.innerText = `🏆 HIGHEST: ${highestScore}`;
            gameOverPanel.style.display = "flex";
        }
        
        function restartGame() {
            enemies.forEach(enemy => scene.remove(enemy));
            arrows.forEach(arrow => scene.remove(arrow.mesh));
            powerups.forEach(p => scene.remove(p));
            enemies = [];
            arrows = [];
            powerups = [];
            score = 0;
            timeLeft = 120;
            health = 100;
            gameActive = true;
            bossPresent = false;
            lastBossThreshold = 0;
            lastArcherThreshold = 0;
            lastBatThreshold = 0;
            lastScoreMilestone = 0;
            speedProgressiveMultiplier = 1.0;
            camera.position.set(0, 1.65, 0);
            updateUI();
            timerSpan.style.color = "white";
            gameOverPanel.style.display = "none";
            
            // Reset background to first color
            lastBgThreshold = -1; // force first update when score >=0
            updateBackgroundColor(); // sets to index 0
            for (let i = 0; i < 3; i++) spawnEnemy();
            if (timerInterval) clearInterval(timerInterval);
            startTimer();
            if (spawnInterval) clearInterval(spawnInterval);
            spawnInterval = setInterval(() => { if (gameActive) spawnEnemy(); }, ENEMY_SPAWN_DELAY * 1000);
            if (powerupSpawnInterval) clearInterval(powerupSpawnInterval);
            powerupSpawnInterval = setInterval(() => { if (gameActive) spawnPowerup(); }, 10000);
            yaw = -Math.PI / 4;
            pitch = 0;
            updateCameraRotation();
            slowMotionActive = false;
            multiShotActive = false;
            enemySpeedMultiplier = 1.0;
        }
        
        restartBtn.addEventListener('click', () => restartGame());
        
        // --- Enemy AI (melee & bosses & bats) ---
        function updateEnemies(deltaTime) {
            if (!gameActive) return;
            const playerPos = camera.position;
            for (let i = 0; i < enemies.length; i++) {
                const enemy = enemies[i];
                if (enemy.userData.isArcher) continue;
                let speed;
                if (enemy.userData.isBoss) speed = getCurrentBossSpeed();
                else if (enemy.userData.isBat) speed = getCurrentBatSpeed();
                else speed = getCurrentEnemySpeed();
                const moveDistance = speed * deltaTime;
                const direction = new THREE.Vector3().subVectors(playerPos, enemy.position).normalize();
                enemy.position.x += direction.x * moveDistance;
                enemy.position.z += direction.z * moveDistance;
                if (enemy.userData.isBat) {
                    enemy.position.y = 1.5 + Math.sin(Date.now() * 0.005) * 0.1;
                } else {
                    enemy.position.y = 1.1 + Math.sin(Date.now() * 0.008 + i) * 0.05;
                }
                const angleToPlayer = Math.atan2(direction.x, direction.z);
                enemy.rotation.y = angleToPlayer;
                if (!enemy.userData.isBat) {
                    const scaleVar = 1 + Math.sin(Date.now() * 0.012) * 0.03;
                    enemy.scale.set(scaleVar, scaleVar, scaleVar);
                }
                if (enemy.position.distanceTo(playerPos) < 1.4) {
                    damagePlayer(enemy.userData.damage);
                    removeEnemy(enemy);
                    i--;
                    if (gameActive) setTimeout(() => { if (gameActive) spawnEnemy(); }, 400);
                }
            }
        }
        
        function updatePowerups(deltaTime) {
            for (let p of powerups) {
                p.rotation.y += 0.03;
                p.position.y = p.userData.floatY + Math.sin(Date.now() * 0.003) * 0.1;
            }
        }
        
        function checkPowerupCollision() {
            if (!gameActive) return;
            const playerPos = camera.position;
            for (let i = 0; i < powerups.length; i++) {
                const p = powerups[i];
                if (playerPos.distanceTo(p.position) < 2.0) {
                    const type = p.userData.type;
                    if (type === 'health') {
                        health = Math.min(100, health + 25);
                        updateUI();
                        setStatusMessage("❤️ HEALTH +25", 1500);
                        for (let j=0; j<8; j++) {
                            const part = new THREE.Mesh(new THREE.SphereGeometry(0.08, 4), new THREE.MeshStandardMaterial({ color: 0x44ff44, emissive: 0x44ff44 }));
                            part.position.copy(p.position);
                            scene.add(part);
                            setTimeout(() => scene.remove(part), 300);
                        }
                    } else if (type === 'slow') {
                        slowMotionActive = true;
                        slowMotionEndTime = Date.now() + 6000;
                        enemySpeedMultiplier = 0.4;
                        setStatusMessage("🐢 SLOW MOTION (6s)", 1500);
                    } else if (type === 'multi') {
                        multiShotActive = true;
                        multiShotEndTime = Date.now() + 8000;
                        setStatusMessage("🔫 MULTI-SHOT (8s)", 1500);
                    }
                    scene.remove(p);
                    powerups.splice(i, 1);
                    i--;
                }
            }
            const now = Date.now();
            if (slowMotionActive && now >= slowMotionEndTime) {
                slowMotionActive = false;
                enemySpeedMultiplier = 1.0;
                setStatusMessage("Slow motion ended", 1000);
            }
            if (multiShotActive && now >= multiShotEndTime) {
                multiShotActive = false;
                setStatusMessage("Multi-shot ended", 1000);
            }
        }
        
        let timeAcc = 0;
        function animateScene(delta) {
            timeAcc += delta;
            flickerLight.intensity = 0.7 + Math.sin(timeAcc * 18) * 0.25;
            particles.rotation.y += 0.002;
            particles.rotation.x = Math.sin(timeAcc * 0.1) * 0.05;
        }
        
        // --- Main Loop ---
        let previousTime = performance.now();
        function gameLoop() {
            const now = performance.now();
            let delta = Math.min(0.033, (now - previousTime) / 1000);
            if (delta <= 0) { previousTime = now; requestAnimationFrame(gameLoop); return; }
            previousTime = now;
            if (gameActive) {
                updatePlayerMovement(delta);
                updateEnemies(delta);
                updateArchers(delta);
                updateArrows(delta);
                updatePowerups(delta);
                checkPowerupCollision();
                animateScene(delta);
            }
            renderer.render(scene, camera);
            requestAnimationFrame(gameLoop);
        }
        
        function init() {
            for (let i = 0; i < 4; i++) spawnEnemy();
            startTimer();
            spawnInterval = setInterval(() => { if (gameActive) spawnEnemy(); }, ENEMY_SPAWN_DELAY * 1000);
            powerupSpawnInterval = setInterval(() => { if (gameActive) spawnPowerup(); }, 10000);
            updateUI();
            // Initial background (index 0)
            scene.background.setHex(bgColors[0]);
            scene.fog.color.setHex(bgColors[0]);
            const ringOfFire = new THREE.PointLight(0xff4411, 0.4, 12);
            ringOfFire.position.set(0, 1, 0);
            scene.add(ringOfFire);
        }
        
        init();
        gameLoop();
        
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });
        
        window.addEventListener('click', enableAudioOnFirstInteraction);
        window.addEventListener('touchstart', enableAudioOnFirstInteraction);
