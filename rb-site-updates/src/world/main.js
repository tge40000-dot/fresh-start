import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
// RB World runs on RB's own backend (rb_world.js), with the same calls the game used on InstantDB.
import { init, id } from './rb_world.js';

// --- CORE ---
const db = init();
const BILLION = 1000000000;
const CAPTURE_RANGE = 0.002;
const SPAWN_RADIUS = 0.01;
const BASE_PRICE = 10000;

// --- STATE ---
let player = {
    id: id(), name: '', netWorth: 50000, empireValue: 0, tokens: 500,
    pos: [-74.006, 40.7128], pov: '3rd', health: 100, armor: 0,
    weapons: [], equippedWeapon: null, kills: 0, deaths: 0, streak: 0,
    avatar: '🧑', subscription: null,
    settings: { nav: 'gps', pov: '3rd', audio: true, radio: true }
};

let scene, camera, renderer, controls, minimap, composer;
let gameRoom, onlinePeers = {}, markers = new Map(), playerMarkers = new Map();
let allAds = [], chatMessages = [], investments = [];
let isAdmin = false, chatOpen = false, combatMode = false, wantedLevel = 0;
let vrSession = null;
let particles, clock;

// --- WEAPONS & SECURITY ---
const WEAPONS = [
    { id:'pistol', name:'Street Pistol', price:2000, dmg:10, tokens:20, tier:1 },
    { id:'smg', name:'Tactical SMG', price:8000, dmg:25, tokens:80, tier:2 },
    { id:'shotgun', name:'Enforcer 12G', price:15000, dmg:40, tokens:150, tier:2 },
    { id:'rifle', name:'Assault Rifle', price:30000, dmg:60, tokens:300, tier:3 },
    { id:'sniper', name:'Executive Sniper', price:50000, dmg:85, tokens:500, tier:3 },
    { id:'rpg', name:'Hostile RPG', price:100000, dmg:100, tokens:1000, tier:4 }
];
const SECURITY = [
    { id:'guard', name:'Security Guard', price:5000, def:15, tokens:50 },
    { id:'cams', name:'Surveillance AI', price:12000, def:30, tokens:120 },
    { id:'vault', name:'Armored Vault', price:25000, def:50, tokens:250 },
    { id:'fortress', name:'Full Fortress', price:60000, def:80, tokens:600 }
];
const AVATARS = ['🧑','👨','👩','🧔','👱','🧑‍🦱','👩‍🦰','🧑‍🦳','👨‍🦲','🥷','🦸','🦹','👮','🕵️','💂','🤴'];

// --- AUDIO ---
const sfx = { cash: null, alert: null, bgm: null };
function initAudio() {
    sfx.bgm = new Audio('/game/assets/audio/hustle-theme.mp3'); sfx.bgm.loop = true; sfx.bgm.volume = 0.3;
    sfx.cash = new Audio('/game/assets/audio/cash-register-chime.mp3');
    sfx.alert = new Audio('/game/assets/audio/mission-alert-ping.mp3');
}
function play(s, v=1) { if (!player.settings.audio || !sfx[s]) return; sfx[s].volume = v; sfx[s].play().catch(()=>{}); }

// --- LOADING ---
async function boot() {
    const fill = document.getElementById('load-fill');
    const text = document.getElementById('load-text');
    const steps = ['LOADING ASSETS', 'BUILDING CITY', 'CONNECTING NETWORK', 'READY'];
    for (let i = 0; i < steps.length; i++) {
        text.innerText = steps[i];
        fill.style.width = `${(i + 1) * 25}%`;
        await sleep(600);
    }
    document.getElementById('loading-screen').style.display = 'none';
    document.getElementById('start-screen').style.display = 'flex';
}

// ============================================
// THREE.JS 3D ENGINE — CINEMATIC OVERHAUL
// ============================================
function init3D() {
    clock = new THREE.Clock();
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    scene.fog = new THREE.FogExp2(0x000000, 0.008);

    camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 35, 55);

    renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('three-canvas'), antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.8;
    renderer.xr.enabled = true;

    // --- POST-PROCESSING (BLOOM) ---
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        1.2,   // strength
        0.4,   // radius
        0.2    // threshold
    );
    composer.addPass(bloomPass);

    // --- LIGHTING ---
    // Ambient (very dim)
    scene.add(new THREE.AmbientLight(0x1a1000, 0.3));

    // Main gold directional light
    const sun = new THREE.DirectionalLight(0xC9A84C, 1.5);
    sun.position.set(30, 60, 20);
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 200;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    scene.add(sun);

    // Gold point lights scattered through city
    const goldPositions = [[0,15,0],[-30,20,-20],[40,25,30],[-50,18,50],[60,22,-40]];
    goldPositions.forEach(p => {
        const light = new THREE.PointLight(0xC9A84C, 2, 80);
        light.position.set(...p);
        scene.add(light);
    });

    // Rim light (blue-gold contrast)
    const rim = new THREE.DirectionalLight(0x4a3a10, 0.5);
    rim.position.set(-40, 30, -50);
    scene.add(rim);

    // --- GROUND (Dark reflective) ---
    const groundGeo = new THREE.PlaneGeometry(500, 500);
    const groundMat = new THREE.MeshStandardMaterial({
        color: 0x050505, metalness: 0.9, roughness: 0.2
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // --- GOLDEN GRID (Circuit-board paths) ---
    const gridMat = new THREE.LineBasicMaterial({ color: 0xC9A84C, transparent: true, opacity: 0.15 });
    for (let i = -200; i <= 200; i += 10) {
        const geoH = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-200, 0.05, i), new THREE.Vector3(200, 0.05, i)]);
        const geoV = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(i, 0.05, -200), new THREE.Vector3(i, 0.05, 200)]);
        scene.add(new THREE.Line(geoH, gridMat));
        scene.add(new THREE.Line(geoV, gridMat));
    }

    // --- WATER PLANE (reflective dark water with gold shimmer) ---
    const waterGeo = new THREE.PlaneGeometry(500, 150);
    const waterMat = new THREE.MeshStandardMaterial({
        color: 0x020200, metalness: 1, roughness: 0.1, transparent: true, opacity: 0.7
    });
    const water = new THREE.Mesh(waterGeo, waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.5, -120);
    scene.add(water);

    // --- CITY BUILDINGS ---
    generateCinematicCity();

    // --- GOLDEN PARTICLES ---
    createGoldenParticles();

    // --- PLAYER ---
    createPlayerMesh();

    // --- CONTROLS ---
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.minDistance = 8;
    controls.maxDistance = 120;
    controls.target.set(0, 5, 0);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
}

function generateCinematicCity() {
    // Dark building materials with gold-lit windows
    const buildingMats = [
        new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.7, roughness: 0.3 }),
        new THREE.MeshStandardMaterial({ color: 0x080808, metalness: 0.8, roughness: 0.2 }),
        new THREE.MeshStandardMaterial({ color: 0x0c0c0c, metalness: 0.6, roughness: 0.4 }),
    ];
    // Gold accent building (rare)
    const goldBuildingMat = new THREE.MeshStandardMaterial({
        color: 0x1a1400, metalness: 0.9, roughness: 0.1, emissive: 0xC9A84C, emissiveIntensity: 0.05
    });

    // Generate skyline
    for (let i = 0; i < 150; i++) {
        const w = 2 + Math.random() * 6;
        const h = 8 + Math.random() * 60;
        const d = 2 + Math.random() * 6;
        const geo = new THREE.BoxGeometry(w, h, d);
        const isGold = Math.random() < 0.08;
        const mat = isGold ? goldBuildingMat : buildingMats[Math.floor(Math.random() * buildingMats.length)];
        const building = new THREE.Mesh(geo, mat);

        // Position in a city grid pattern
        const gridX = (Math.random() - 0.5) * 220;
        const gridZ = (Math.random() - 0.5) * 180;
        building.position.set(gridX, h / 2, gridZ);
        building.castShadow = true;
        building.receiveShadow = true;
        scene.add(building);

        // GOLDEN WINDOW LIGHTS (emissive planes)
        const windowMat = new THREE.MeshBasicMaterial({
            color: 0xC9A84C, transparent: true, opacity: 0.4 + Math.random() * 0.4
        });
        const floors = Math.floor(h / 3);
        for (let f = 1; f < floors; f++) {
            if (Math.random() < 0.5) continue; // some floors dark
            const windowsPerFloor = Math.floor(w / 1.5);
            for (let wx = 0; wx < windowsPerFloor; wx++) {
                if (Math.random() < 0.4) continue; // random windows lit
                const winGeo = new THREE.PlaneGeometry(0.6, 0.8);
                const win = new THREE.Mesh(winGeo, windowMat);
                const xOff = -w/2 + 0.8 + wx * 1.5;
                const yPos = f * 3;
                // Front face
                win.position.set(gridX + xOff, yPos, gridZ + d/2 + 0.01);
                scene.add(win);
                // Back face
                const win2 = win.clone();
                win2.position.z = gridZ - d/2 - 0.01;
                win2.rotation.y = Math.PI;
                scene.add(win2);
            }
        }

        // Gold accent strip on top of some buildings
        if (isGold || Math.random() < 0.15) {
            const stripGeo = new THREE.BoxGeometry(w + 0.2, 0.3, d + 0.2);
            const stripMat = new THREE.MeshBasicMaterial({ color: 0xC9A84C });
            const strip = new THREE.Mesh(stripGeo, stripMat);
            strip.position.set(gridX, h, gridZ);
            scene.add(strip);
        }
    }

    // --- RB BILLBOARD (Glowing) ---
    const bbGeo = new THREE.PlaneGeometry(16, 8);
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d');
    // Black background with gold border
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 1024, 512);
    ctx.strokeStyle = '#C9A84C'; ctx.lineWidth = 6;
    ctx.strokeRect(10, 10, 1004, 492);
    // Ornate corners (simplified)
    ctx.strokeStyle = '#C9A84C'; ctx.lineWidth = 2;
    [0, 1, 2, 3].forEach(corner => {
        const cx = corner < 2 ? 40 : 984;
        const cy = corner % 2 === 0 ? 40 : 472;
        ctx.beginPath(); ctx.arc(cx, cy, 20, 0, Math.PI * 2); ctx.stroke();
    });
    // Shield/Crown logo
    ctx.font = 'bold 120px serif';
    ctx.fillStyle = '#C9A84C';
    ctx.textAlign = 'center';
    ctx.fillText('R', 480, 220);
    ctx.fillText('B', 560, 220);
    // Crown
    ctx.font = '40px serif';
    ctx.fillText('👑', 512, 100);
    // Subtitle
    ctx.font = '36px sans-serif';
    ctx.fillStyle = '#C9A84C';
    ctx.fillText('RELENTLESS BILLIONAIRE', 512, 320);
    ctx.font = '20px sans-serif';
    ctx.fillStyle = '#8a7030';
    ctx.fillText('CONQUER THE CITY. BUILD YOUR EMPIRE.', 512, 380);
    ctx.fillText('relentlessbillionaire.com/game', 512, 440);

    const bbTexture = new THREE.CanvasTexture(canvas);
    const bbMat = new THREE.MeshBasicMaterial({ map: bbTexture });
    const billboard = new THREE.Mesh(bbGeo, bbMat);
    billboard.position.set(0, 35, -60);
    scene.add(billboard);

    // Billboard glow frame
    const frameGeo = new THREE.BoxGeometry(16.5, 8.5, 0.2);
    const frameMat = new THREE.MeshBasicMaterial({ color: 0xC9A84C, transparent: true, opacity: 0.3 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.set(0, 35, -60.2);
    scene.add(frame);

    // --- LUXURY VEHICLES (simple geometric representations) ---
    // Supercar
    const carGroup = new THREE.Group();
    const carBody = new THREE.Mesh(
        new THREE.BoxGeometry(4, 1, 2),
        new THREE.MeshStandardMaterial({ color: 0x0a0a0a, metalness: 0.95, roughness: 0.05 })
    );
    carBody.position.y = 0.7;
    carGroup.add(carBody);
    const carTop = new THREE.Mesh(
        new THREE.BoxGeometry(2, 0.6, 1.8),
        new THREE.MeshStandardMaterial({ color: 0x050505, metalness: 0.9, roughness: 0.1 })
    );
    carTop.position.set(-0.3, 1.3, 0);
    carGroup.add(carTop);
    // Gold accent line
    const carAccent = new THREE.Mesh(
        new THREE.BoxGeometry(4.1, 0.05, 0.05),
        new THREE.MeshBasicMaterial({ color: 0xC9A84C })
    );
    carAccent.position.set(0, 0.9, 1.01);
    carGroup.add(carAccent);
    carGroup.position.set(15, 0, 20);
    scene.add(carGroup);

    // --- ROAD MARKINGS (gold) ---
    for (let i = -180; i < 180; i += 8) {
        const markGeo = new THREE.PlaneGeometry(3, 0.15);
        const markMat = new THREE.MeshBasicMaterial({ color: 0xC9A84C, transparent: true, opacity: 0.3 });
        const mark = new THREE.Mesh(markGeo, markMat);
        mark.rotation.x = -Math.PI / 2;
        mark.position.set(i, 0.02, 0);
        scene.add(mark);
        const mark2 = mark.clone();
        mark2.rotation.z = Math.PI / 2;
        mark2.position.set(0, 0.02, i);
        scene.add(mark2);
    }
}

function createGoldenParticles() {
    const count = 500;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i += 3) {
        positions[i] = (Math.random() - 0.5) * 200;
        positions[i + 1] = Math.random() * 60;
        positions[i + 2] = (Math.random() - 0.5) * 200;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
        color: 0xC9A84C, size: 0.3, transparent: true, opacity: 0.6,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    particles = new THREE.Points(geo, mat);
    scene.add(particles);
}

let playerMesh;
function createPlayerMesh() {
    const group = new THREE.Group();
    // Body (gold metallic capsule)
    const body = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.5, 1.5, 8, 16),
        new THREE.MeshStandardMaterial({ color: 0xC9A84C, metalness: 0.8, roughness: 0.2, emissive: 0x4a3a10, emissiveIntensity: 0.2 })
    );
    body.position.y = 1.5; body.castShadow = true;
    group.add(body);
    // Head
    const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.4, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0xffdbac, metalness: 0.1, roughness: 0.8 })
    );
    head.position.y = 2.8; head.castShadow = true;
    group.add(head);
    // Glow ring (pulsing)
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.8, 1.2, 32),
        new THREE.MeshBasicMaterial({ color: 0xC9A84C, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.1;
    group.add(ring);
    // Point light on player
    const playerLight = new THREE.PointLight(0xC9A84C, 1, 15);
    playerLight.position.y = 2;
    group.add(playerLight);
    scene.add(group);
    playerMesh = group;
}

function animate() {
    renderer.setAnimationLoop(() => {
        const delta = clock.getDelta();
        const elapsed = clock.getElapsedTime();
        controls.update();

        // Animate particles (slow drift upward)
        if (particles) {
            const pos = particles.geometry.attributes.position.array;
            for (let i = 1; i < pos.length; i += 3) {
                pos[i] += 0.02;
                if (pos[i] > 60) pos[i] = 0;
            }
            particles.geometry.attributes.position.needsUpdate = true;
        }

        // Pulse player glow
        if (playerMesh) {
            const ring = playerMesh.children[2];
            if (ring) ring.material.opacity = 0.3 + Math.sin(elapsed * 2) * 0.15;
        }

        // Render with bloom
        composer.render();
    });
}

// --- MINIMAP ---
function initMinimap() {
    minimap = new maplibregl.Map({
        container: 'minimap',
        style: 'https://tiles.basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: player.pos, zoom: 14, interactive: false
    });
}

// --- WEBXR VR ---
async function enterVR() {
    if (!navigator.xr) { alert('WebXR not supported on this device.'); return; }
    try {
        const supported = await navigator.xr.isSessionSupported('immersive-vr');
        if (!supported) { alert('VR not available. Using AR/GPS mode.'); startGPS(); return; }
        vrSession = await navigator.xr.requestSession('immersive-vr', { requiredFeatures: ['local-floor'] });
        renderer.xr.setSession(vrSession);
        document.getElementById('vr-indicator').style.display = 'block';
        startGPS();
    } catch (e) { alert('VR init failed: ' + e.message); startGPS(); }
}

// --- GPS ---
function startGPS() {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition(pos => {
        player.pos = [pos.coords.longitude, pos.coords.latitude];
        if (minimap) minimap.setCenter(player.pos);
    }, () => {}, { enableHighAccuracy: true });
}

// --- GAME INIT ---
async function startGame() {
    const name = document.getElementById('input-name').value.trim();
    player.name = name || `Hustler_${Math.floor(Math.random() * 1000)}`;

    if (document.getElementById('chk-admin').checked) { window.location.href = '/admin'; return; }

    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('game-container').style.display = 'block';

    init3D();
    initMinimap();
    initAudio();
    loadState();
    if (player.settings.audio) play('bgm', 0.3);
    if (player.settings.nav === 'gps') startGPS();

    // Other players, chat and the leaderboard (RB World backend)
    const room = db.joinRoom('game', 'rb-city-1');
    gameRoom = room;
    room.subscribePresence({}, d => { if (d?.peers) onlinePeers = d.peers; });
    try { room.subscribeTopic('chat', msg => receiveChat(msg)); } catch(e){}
    db.subscribeQuery({ users: {} }, r => { if (r.data) updateLeaderboard(r.data.users); });
    db.subscribeQuery({ ads: {} }, r => { if (r.data) { allAds = r.data.ads || []; } });

    setInterval(() => {
        try { room.publishPresence({ id: player.id, name: player.name, pos: player.pos, netWorth: player.netWorth, health: player.health }); } catch(e){}
    }, 1000);

    safeTransact(db.tx.users[player.id].update({ name: player.name, netWorth: player.netWorth, tokens: player.tokens, lastActive: Date.now() }));

    setInterval(updateHUD, 1000);
    setInterval(processROI, 10000);
    setInterval(processInvestROI, 30000);
    setInterval(rotateTicker, 5000);

    bindControls();
    fetchCalendarEvents();
}

// --- HUD ---
function updateHUD() {
    document.getElementById('s-networth').innerText = `$${fmt(player.netWorth)}`;
    document.getElementById('s-empire').innerText = `$${fmt(player.empireValue)}`;
    document.getElementById('s-tokens').innerText = player.tokens;
    document.getElementById('billion-fill').style.width = `${Math.min((player.netWorth / BILLION) * 100, 100)}%`;
    document.getElementById('hp-fill').style.width = `${player.health}%`;
    document.getElementById('hp-val').innerText = player.health;
    document.getElementById('armor-val').innerText = player.armor;
    document.getElementById('wanted-val').innerText = '★'.repeat(wantedLevel) + '☆'.repeat(5 - wantedLevel);
    const w = WEAPONS.find(x => x.id === player.equippedWeapon);
    document.getElementById('weapon-val').innerText = w ? w.name : 'Unarmed';
}

function updateLeaderboard(users) {
    const list = document.getElementById('lb-list'); list.innerHTML = '';
    const sorted = Object.values(users).sort((a, b) => b.netWorth - a.netWorth).slice(0, 10);
    sorted.forEach((u, i) => {
        const me = u.id === player.id;
        const worth = u.netWorth >= 1e6 ? `$${(u.netWorth/1e6).toFixed(1)}M` : `$${Math.floor(u.netWorth/1000)}k`;
        list.innerHTML += `<div class="lb-item" style="${me?'color:var(--green);':''}"><span class="lb-rank">#${i+1}</span><span class="lb-name">${esc(u.name)}${me?' (You)':''}</span><span class="lb-worth">${worth}</span></div>`;
        if (me) document.getElementById('s-rank').innerText = `#${i+1}`;
    });
}

// --- CONTROLS ---
function bindControls() {
    document.getElementById('btn-profile').onclick = () => toggleOverlay('ov-profile', renderProfile);
    document.getElementById('btn-chat').onclick = toggleChat;
    document.getElementById('btn-chat-close').onclick = toggleChat;
    document.getElementById('btn-send').onclick = sendChat;
    document.getElementById('chat-input').onkeydown = e => { if (e.key === 'Enter') sendChat(); };
    document.getElementById('btn-shop').onclick = () => toggleOverlay('ov-shop', renderShop);
    document.getElementById('btn-close-shop').onclick = () => hide('ov-shop');
    document.getElementById('btn-combat').onclick = toggleCombat;
    document.getElementById('btn-hustle').onclick = triggerMission;
    document.getElementById('btn-accept').onclick = acceptMission;
    document.getElementById('btn-decline').onclick = () => hide('ov-mission');
    document.getElementById('btn-invest').onclick = () => toggleOverlay('ov-invest', renderInvest);
    document.getElementById('btn-close-invest').onclick = () => hide('ov-invest');
    document.getElementById('btn-pov').onclick = togglePOV;
    document.getElementById('btn-vr').onclick = enterVR;
    document.getElementById('btn-settings').onclick = () => toggleOverlay('ov-settings');
    document.getElementById('btn-close-settings').onclick = () => hide('ov-settings');
    document.getElementById('btn-close-profile').onclick = () => hide('ov-profile');
    document.getElementById('btn-subscribe').onclick = handleSubscribe;
    document.getElementById('btn-close-sub').onclick = () => hide('ov-subscribe');
    document.getElementById('btn-close-redeem').onclick = () => hide('ov-redeem');
    document.getElementById('btn-verify').onclick = verifyPurchase;
    document.getElementById('btn-skip-ad').onclick = () => hide('ov-video');
}

// --- OVERLAYS ---
function toggleOverlay(id, render) { const el = document.getElementById(id); const vis = el.style.display === 'flex'; el.style.display = vis ? 'none' : 'flex'; if (!vis && render) render(); }
function hide(id) { document.getElementById(id).style.display = 'none'; }
function show(id) { document.getElementById(id).style.display = 'flex'; }

// --- PROFILE & AVATAR ---
function renderProfile() {
    const opts = document.getElementById('avatar-options'); opts.innerHTML = '';
    AVATARS.forEach(a => {
        const d = document.createElement('div'); d.className = 'avatar-opt' + (player.avatar === a ? ' selected' : '');
        d.innerText = a; d.onclick = () => { player.avatar = a; document.getElementById('avatar-display').innerText = a; saveState(); renderProfile(); };
        opts.appendChild(d);
    });
    const stats = document.getElementById('profile-stats');
    stats.innerHTML = `
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(201,168,76,0.1);font-size:11px;"><span style="color:rgba(255,255,255,0.5);">Name</span><span>${esc(player.name)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(201,168,76,0.1);font-size:11px;"><span style="color:rgba(255,255,255,0.5);">Net Worth</span><span style="color:var(--gold);">$${fmt(player.netWorth)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(201,168,76,0.1);font-size:11px;"><span style="color:rgba(255,255,255,0.5);">Empire</span><span style="color:var(--green);">$${fmt(player.empireValue)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(201,168,76,0.1);font-size:11px;"><span style="color:rgba(255,255,255,0.5);">Tokens</span><span>${player.tokens}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(201,168,76,0.1);font-size:11px;"><span style="color:rgba(255,255,255,0.5);">Health</span><span>${player.health}/100</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(201,168,76,0.1);font-size:11px;"><span style="color:rgba(255,255,255,0.5);">Armor</span><span>${player.armor}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(201,168,76,0.1);font-size:11px;"><span style="color:rgba(255,255,255,0.5);">Weapon</span><span>${WEAPONS.find(w=>w.id===player.equippedWeapon)?.name||'Unarmed'}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(201,168,76,0.1);font-size:11px;"><span style="color:rgba(255,255,255,0.5);">K/D</span><span>${player.kills}/${player.deaths}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(201,168,76,0.1);font-size:11px;"><span style="color:rgba(255,255,255,0.5);">Streak</span><span>${player.streak}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(201,168,76,0.1);font-size:11px;"><span style="color:rgba(255,255,255,0.5);">Subscription</span><span>${player.subscription||'Free'}</span></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:11px;"><span style="color:rgba(255,255,255,0.5);">Progress</span><span style="color:var(--gold);">${((player.netWorth/BILLION)*100).toFixed(4)}%</span></div>`;
}

// --- WEAPON SHOP ---
function renderShop() {
    const list = document.getElementById('shop-list'); list.innerHTML = '';
    WEAPONS.forEach(w => {
        const owned = player.weapons.includes(w.id);
        const eq = player.equippedWeapon === w.id;
        list.innerHTML += `<div style="background:rgba(0,0,0,0.5);border:1px solid ${owned?'var(--green)':'rgba(201,168,76,0.15)'};border-radius:10px;padding:12px;margin-bottom:8px;backdrop-filter:blur(4px);">
            <div style="display:flex;justify-content:space-between;align-items:center;"><span style="font-weight:800;font-size:12px;color:white;">${w.name}</span><span style="font-size:8px;background:${w.tier<=2?'rgba(201,168,76,0.2)':'rgba(255,59,59,0.2)'};color:${w.tier<=2?'var(--gold)':'var(--red)'};padding:2px 8px;border-radius:4px;font-weight:900;">T${w.tier}</span></div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4);margin:6px 0;">DMG: ${w.dmg} | $${w.price.toLocaleString()} | ${w.tokens} tokens</div>
            <button onclick="window._buyWeapon('${w.id}')" style="width:100%;padding:10px;border:none;border-radius:8px;font-weight:900;font-size:10px;cursor:pointer;letter-spacing:1px;background:${eq?'rgba(0,191,255,0.2)':owned?'rgba(0,230,118,0.2)':'linear-gradient(135deg,#6B4F0F,#C9A84C)'};color:${eq||owned?'white':'black'};border:1px solid ${eq?'var(--blue)':owned?'var(--green)':'transparent'};">${eq?'EQUIPPED':owned?'EQUIP':'BUY'}</button>
        </div>`;
    });
    const sec = document.getElementById('security-list'); sec.innerHTML = '';
    SECURITY.forEach(s => {
        sec.innerHTML += `<div style="background:rgba(0,0,0,0.5);border:1px solid rgba(0,191,255,0.15);border-radius:10px;padding:12px;margin-bottom:8px;backdrop-filter:blur(4px);">
            <div style="font-weight:800;font-size:12px;color:white;">${s.name}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4);margin:6px 0;">DEF: +${s.def} | $${s.price.toLocaleString()} | ${s.tokens} tokens</div>
            <button onclick="window._buySecurity('${s.id}')" style="width:100%;padding:10px;border:none;border-radius:8px;font-weight:900;font-size:10px;cursor:pointer;letter-spacing:1px;background:rgba(0,191,255,0.15);color:var(--blue);border:1px solid rgba(0,191,255,0.3);">DEPLOY</button>
        </div>`;
    });
}
window._buyWeapon = (wid) => {
    const w = WEAPONS.find(x=>x.id===wid);
    if (player.weapons.includes(wid)) { player.equippedWeapon = wid; saveState(); renderShop(); return; }
    if (player.netWorth >= w.price && player.tokens >= w.tokens) {
        player.netWorth -= w.price; player.tokens -= w.tokens; player.weapons.push(wid); player.equippedWeapon = wid;
        saveState(); play('cash'); renderShop();
        safeTransact(db.tx.users[player.id].update({ netWorth: player.netWorth, tokens: player.tokens }));
    } else { alert(`Need $${w.price.toLocaleString()} + ${w.tokens} tokens`); }
};
window._buySecurity = (sid) => {
    const s = SECURITY.find(x=>x.id===sid);
    if (player.netWorth >= s.price && player.tokens >= s.tokens) {
        player.netWorth -= s.price; player.tokens -= s.tokens; player.armor += s.def;
        saveState(); play('cash'); alert(`${s.name} deployed! Armor +${s.def}`);
        safeTransact(db.tx.users[player.id].update({ netWorth: player.netWorth, tokens: player.tokens }));
    } else { alert(`Need $${s.price.toLocaleString()} + ${s.tokens} tokens`); }
};

// --- COMBAT ---
function toggleCombat() {
    combatMode = !combatMode;
    document.getElementById('btn-combat').classList.toggle('active', combatMode);
    document.getElementById('combat-hud').style.display = combatMode ? 'block' : 'none';
}

// --- POV ---
function togglePOV() {
    player.pov = player.pov === '1st' ? '3rd' : '1st';
    if (player.pov === '1st') { camera.position.set(0, 3, 5); controls.maxDistance = 20; }
    else { camera.position.set(0, 35, 55); controls.maxDistance = 120; }
    document.getElementById('btn-pov').innerText = player.pov === '1st' ? '👁️' : '🎮';
}

// --- MISSIONS ---
let activeMission = null;
const MISSIONS = [
    { title:'HOSTILE TAKEOVER', desc:'A rival startup is vulnerable. Acquire their user base for $5K.', cost:0, reward:5000, tokens:25 },
    { title:'INSIDER TRADE', desc:'Leaked merger info. Invest $2K for $8K payout.', cost:2000, reward:8000, tokens:40 },
    { title:'VENTURE CAPITAL', desc:'Investor seeking deployment. Secure the block.', cost:0, reward:10000, tokens:50 },
    { title:'ARMS DEAL', desc:'Weapons shipment at the docks. Cost: $3K.', cost:3000, reward:6000, tokens:30 },
    { title:'FRANCHISE FLIP', desc:'Failing franchise. Buy low sell high. $5K.', cost:5000, reward:15000, tokens:75 },
    { title:'THE HEIST', desc:'High-security vault. Risk it all. Cost: $10K.', cost:10000, reward:25000, tokens:100 },
    { title:'PROTECTION RACKET', desc:'Local businesses need protection. Collect $7K.', cost:0, reward:7000, tokens:35 },
];
function triggerMission() {
    activeMission = MISSIONS[Math.floor(Math.random() * MISSIONS.length)];
    document.getElementById('mission-title').innerText = activeMission.title;
    document.getElementById('mission-desc').innerText = activeMission.desc;
    show('ov-mission'); play('alert');
}
function acceptMission() {
    hide('ov-mission');
    if (activeMission.cost > player.netWorth) { alert('Not enough funds.'); return; }
    player.netWorth -= activeMission.cost;
    setTimeout(() => {
        const success = Math.random() < 0.7;
        if (success) {
            player.netWorth += activeMission.reward; player.tokens += activeMission.tokens; player.streak++;
            play('cash'); alert(`SUCCESS: ${activeMission.title}\n+$${activeMission.reward.toLocaleString()} +${activeMission.tokens} tokens`);
        } else {
            wantedLevel = Math.min(wantedLevel + 1, 5);
            if (wantedLevel >= 3) copEncounter();
            else { player.netWorth -= 5000; alert(`FAILED. Lost $5,000. Wanted: ${wantedLevel}/5`); }
        }
        safeTransact(db.tx.users[player.id].update({ netWorth: player.netWorth, tokens: player.tokens }));
    }, 2500);
}
function copEncounter() {
    const cost = 2000 * wantedLevel;
    if (player.netWorth >= cost && confirm(`COPS! Hire lawyer for $${cost.toLocaleString()}?\n\nNo = Jail (lose $${(5000*wantedLevel).toLocaleString()})`)) {
        player.netWorth -= cost; wantedLevel = 0; alert('Lawyer cleared you.');
    } else { player.netWorth -= 5000 * wantedLevel; wantedLevel = 0; player.streak = 0; alert('Jailed!'); }
}

// --- INVEST ---
function renderInvest() {
    const list = document.getElementById('invest-list'); list.innerHTML = '';
    const biz = allAds.filter(a => a.channel === 'Business' && a.status === 'live');
    if (biz.length === 0) list.innerHTML = '<div style="font-size:11px;color:rgba(255,255,255,0.4);padding:12px;text-align:center;">No businesses accepting investment.<br>Admin must list them.</div>';
    biz.forEach(b => {
        list.innerHTML += `<div style="background:rgba(0,0,0,0.5);border:1px solid rgba(0,230,118,0.15);border-radius:10px;padding:12px;margin-bottom:8px;">
            <div style="font-weight:800;font-size:12px;color:white;">${esc(b.title)}</div>
            <div style="font-size:10px;color:rgba(255,255,255,0.4);margin:6px 0;">${esc(b.body)} | Min: $${(b.price||5000).toLocaleString()} | ROI: 8%</div>
            <button onclick="window._invest('${b.id}')" style="width:100%;padding:10px;border:none;border-radius:8px;font-weight:900;font-size:10px;cursor:pointer;background:rgba(0,230,118,0.15);color:var(--green);border:1px solid rgba(0,230,118,0.3);letter-spacing:1px;">INVEST</button>
        </div>`;
    });
    list.innerHTML += `<div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(201,168,76,0.1);"><div style="font-size:9px;font-weight:900;color:var(--gold);letter-spacing:2px;margin-bottom:10px;">TOKEN EXCHANGE</div>
        <div style="display:flex;gap:8px;">
            <button onclick="window._buyTokens()" style="flex:1;padding:10px;border:none;border-radius:8px;font-weight:900;font-size:9px;cursor:pointer;background:linear-gradient(135deg,#6B4F0F,#C9A84C);color:black;letter-spacing:1px;">BUY 50 ($5K)</button>
            <button onclick="window._sellTokens()" style="flex:1;padding:10px;border:none;border-radius:8px;font-weight:900;font-size:9px;cursor:pointer;background:rgba(255,59,59,0.15);color:var(--red);border:1px solid rgba(255,59,59,0.3);letter-spacing:1px;">SELL 50 (+$5K)</button>
        </div></div>`;
}
window._invest = (bizId) => {
    const biz = allAds.find(a=>a.id===bizId); if (!biz) return;
    const amt = biz.price || 5000;
    if (player.netWorth < amt) { alert(`Need $${amt.toLocaleString()}`); return; }
    player.netWorth -= amt; player.tokens += Math.floor(amt/100);
    investments.push({ bizId, amount: amt, ts: Date.now() }); saveState(); play('cash');
    alert(`Invested $${amt.toLocaleString()} in ${biz.title}! 8% ROI per cycle.`);
    safeTransact(db.tx.users[player.id].update({ netWorth: player.netWorth, tokens: player.tokens }));
};
window._buyTokens = () => { if (player.netWorth < 5000) { alert('Need $5K'); return; } player.netWorth -= 5000; player.tokens += 50; play('cash'); safeTransact(db.tx.users[player.id].update({ netWorth: player.netWorth, tokens: player.tokens })); renderInvest(); };
window._sellTokens = () => { if (player.tokens < 50) { alert('Need 50 tokens'); return; } player.tokens -= 50; player.netWorth += 5000; play('cash'); safeTransact(db.tx.users[player.id].update({ netWorth: player.netWorth, tokens: player.tokens })); renderInvest(); };

// --- ROI ---
function processROI() { player.netWorth += player.empireValue * 0.05; player.tokens += Math.floor(player.empireValue * 0.05 / 1000); }
function processInvestROI() { investments.forEach(inv => { player.netWorth += Math.floor(inv.amount * 0.08); player.tokens += Math.floor(inv.amount * 0.08 / 500); }); safeTransact(db.tx.users[player.id].update({ netWorth: player.netWorth, tokens: player.tokens })); }

// --- CHAT ---
function toggleChat() { chatOpen = !chatOpen; document.getElementById('chat-panel').classList.toggle('open', chatOpen); }
function sendChat() { const input = document.getElementById('chat-input'); const t = input.value.trim(); if (!t) return; const msg = { id: id(), senderId: player.id, author: player.name, text: t.slice(0,240), ts: Date.now() }; receiveChat(msg, true); try { gameRoom.publishTopic('chat', msg); } catch(e){} input.value = ''; }
function receiveChat(msg, local=false) { if (!msg?.text) return; if (!local && msg.senderId === player.id) return; chatMessages.push(msg); if (chatMessages.length > 100) chatMessages.shift(); renderChat(); }
function renderChat() { const c = document.getElementById('chat-messages'); c.innerHTML = ''; chatMessages.forEach(m => { c.innerHTML += `<div class="chat-msg"><div class="author">${m.senderId===player.id?'You':esc(m.author)}</div><div class="text">${esc(m.text)}</div></div>`; }); c.scrollTop = c.scrollHeight; }

// --- TICKER ---
function rotateTicker() {
    const t = document.getElementById('ticker-text');
    const live = allAds.filter(a => a.status === 'live' && a.channel === 'Ticker');
    if (live.length > 0) { const a = live[Math.floor(Date.now()/5000) % live.length]; t.innerText = `${a.title} — ${a.body}`; }
    else { t.innerText = 'Relentless Billionaire — Conquer. Build. Dominate. | relentlessbillionaire.com'; }
}

// --- STRIPE SUBSCRIPTION ---
function handleSubscribe() {
    // RB memberships, with what each includes, are on the main site.
    window.location.href = '/memberships';
}

// --- RB BADGE POINTS ---
// Play time while signed in earns RB Badge points (counted by RB, see rb_world.js); this opens the RB app.
function verifyPurchase() {
    window.location.href = '/app';
}

// --- CALENDAR EVENTS ---
function fetchCalendarEvents() {
    setInterval(() => {
        const events = allAds.filter(a => a.channel === 'Ticker' && a.status === 'live');
        const el = document.getElementById('events-list'); el.innerHTML = '';
        if (events.length === 0) { el.innerHTML = '<div class="event-item">No upcoming events</div>'; return; }
        events.slice(0, 3).forEach(e => { el.innerHTML += `<div class="event-item">${esc(e.title)}</div>`; });
    }, 10000);
}

// --- PERSISTENCE ---
function loadState() {
    try { const s = localStorage.getItem('rb_state'); if (s) { const p = JSON.parse(s); Object.assign(player, { ...player, ...p }); } } catch(e){}
    try { const i = localStorage.getItem('rb_investments'); if (i) investments = JSON.parse(i); } catch(e){}
}
function saveState() {
    try { localStorage.setItem('rb_state', JSON.stringify({ weapons: player.weapons, equippedWeapon: player.equippedWeapon, armor: player.armor, kills: player.kills, deaths: player.deaths, avatar: player.avatar, subscription: player.subscription, settings: player.settings })); } catch(e){}
    try { localStorage.setItem('rb_investments', JSON.stringify(investments)); } catch(e){}
}

// --- UTILS ---
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function fmt(n) { return Math.floor(n).toLocaleString(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function safeTransact(tx) { try { const p = db.transact(tx); if (p?.catch) p.catch(()=>{}); } catch(e){} }

// --- BOOT ---
document.getElementById('btn-start').addEventListener('click', startGame);
boot();
