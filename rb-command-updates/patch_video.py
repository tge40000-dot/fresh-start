"""Video creator upgrades (rb-command /video): an audio visualizer and progress line drawn into the video, a 9:16
safe-zone guide, keyboard shortcuts and a link to RB Create.

Usage: python3 -I patch_video.py <pulled rb-command dir>

- Fine-tune > Visualizer: None, Bars, Wave, Ring or Glow, moving with the song's loudness (the editor already measures
  it every 20 ms to find the beat), with a position, a size and an optional progress line along the bottom. It is drawn
  in the same frame function as the photos and words, so the preview, the poster and the exported file all match.
  It stays off the end card. Off by default, so existing videos look exactly as before.
- Preview only: a guide that shades where TikTok, Reels and Shorts put their buttons on a 9:16 video (never exported).
- Space plays or pauses; the left and right arrows move one second.
- The header links to RB Create (relentlessbillionaire.com/create), the public creator.
The editor bundle is a string module; it is decoded, edited at exact anchors, and written back. Running it twice changes nothing.
"""
import json
import pathlib
import sys

folder = pathlib.Path(sys.argv[1])
changed = []


def make_rep(name, get, put):
    def rep(old, new, what):
        s = get()
        if new in s:
            return
        if s.count(old) != 1:
            raise SystemExit(f"rb-command/{name}: {what}: anchor found {s.count(old)} times")
        put(s.replace(old, new))
        changed.append(what)
    return rep


# ---------------------------------------------------------------- the editor bundle
bp = folder / "video_bundle.js"
raw = bp.read_text(encoding="utf-8")
HEAD = "export default "
cut = raw.index(HEAD)
prefix, lit = raw[:cut], raw[cut + len(HEAD):].rstrip()
if not lit.endswith(";"):
    raise SystemExit("rb-command/video_bundle.js: expected `export default \"…\";`")
box = {"s": json.loads(lit[:-1])}
brep = make_rep("video_bundle.js", lambda: box["s"], lambda v: box.__setitem__("s", v))

brep('fps:30,quality:"standard"},Ji={',
     'fps:30,quality:"standard",viz:"none",vizPos:"bottom",vizSize:100,progress:"none"},Ji={', "visualizer defaults")
brep('fps:[24,30,60],quality:["standard","high"]},Lt={motion:[0,200],bright:[-40,40],vignette:[0,100],titleSize:[60,140]}',
     'fps:[24,30,60],quality:["standard","high"],viz:["none","bars","wave","ring","glow"],vizPos:["bottom","middle","top"],progress:["none","line"]},'
     'Lt={motion:[0,200],bright:[-40,40],vignette:[0,100],titleSize:[60,140],vizSize:[50,200]}', "visualizer choices")
brep('titleSize:e=>`${e}%`};function mt(){', 'titleSize:e=>`${e}%`,vizSize:e=>`${e}%`};function mt(){', "visualizer size label")
VIZ = (
    # loudness (0..1) at a time in the video, from the editor's own 20 ms analysis of the song
    'function rbVAt(t){let n=l.an;if(!n||!n.env.length)return 0;let k=Math.floor((l.start+t)*n.rate);return k<0||k>=n.env.length?0:n.env[k]}'
    # the visualizer layer: drawn under the words, never on the end card
    'function rbViz(e,t,a,i,r,I){if(t>=I)return;'
    'if(R.progress==="line"){let y=i-14*r,x=40*r,w=a-80*r;e.fillStyle="rgba(255,255,255,.16)",e.fillRect(x,y,w,3*r),e.fillStyle=be(e,x,0,x+w,0),e.fillRect(x,y,w*H(t/Math.max(.01,I),0,1),3*r)}'
    'let v=R.viz;if(v==="none"||!l.an)return;'
    'let s=R.vizSize/100,tall=i>a,cy=R.vizPos==="top"?i*.2:R.vizPos==="middle"?i*.5:i*(tall?.9:.86),w=a*(tall?.84:.62),x0=(a-w)/2,now=rbVAt(t);'
    'e.save(),e.shadowColor=nt(.55),e.shadowBlur=18*r;'
    'if(v==="bars"){let N=40,g=w/N,hm=(tall?160:120)*r*s;e.fillStyle=be(e,x0,0,x0+w,0);'
    'for(let j=0;j<N;j++){let dd=Math.abs(j-(N-1)/2)/((N-1)/2),hh=Math.max(3*r,hm*rbVAt(t-dd*.9)*(1-.35*dd));e.fillRect(x0+j*g+g*.18,cy-hh/2,g*.64,hh)}}'
    'else if(v==="wave"){let N=120,hm=(tall?120:90)*r*s;e.strokeStyle=be(e,x0,0,x0+w,0),e.lineWidth=4*r,e.lineJoin="round";'
    'for(let sd of[1,-1]){e.beginPath();for(let j=0;j<=N;j++){let u=j/N,yy=cy-sd*rbVAt(t+(u-.5)*2.4)*hm*Math.sin(Math.PI*u)*(.6+.4*Math.sin(j*.9+t*6));j?e.lineTo(x0+u*w,yy):e.moveTo(x0+u*w,yy)}e.globalAlpha=sd>0?1:.45,e.stroke()}e.globalAlpha=1}'
    'else if(v==="ring"){let R0=Math.min(a,i)*.16*s,N=72,c=H(cy,R0*1.9,i-R0*1.9);e.strokeStyle=be(e,a/2-R0,0,a/2+R0,0),e.lineCap="round",e.lineWidth=Math.max(2,5*r*s);'
    'for(let j=0;j<N;j++){let ang=j/N*Math.PI*2-Math.PI/2,k=Math.abs(j/N*2-1),len=R0*(.08+.6*rbVAt(t-k*.7)),c0=Math.cos(ang),s0=Math.sin(ang);e.beginPath(),e.moveTo(a/2+c0*R0*1.08,c+s0*R0*1.08),e.lineTo(a/2+c0*(R0*1.08+len),c+s0*(R0*1.08+len)),e.stroke()}'
    'e.lineWidth=2*r,e.beginPath(),e.arc(a/2,c,R0*(1+.05*now),0,Math.PI*2),e.stroke()}'
    'else if(v==="glow"){e.shadowBlur=0;let gr=e.createRadialGradient(a/2,cy,0,a/2,cy,Math.max(a,i)*.6*s);gr.addColorStop(0,nt(.5*now)),gr.addColorStop(1,nt(0)),e.fillStyle=gr,e.fillRect(0,0,a,i)}'
    'e.restore()}'
)
brep("function qe(e,t,a,i,n,o){", VIZ + "function qe(e,t,a,i,n,o){", "visualizer layer")
brep("e.globalAlpha=1);for(let T of l.texts){", "e.globalAlpha=1);rbViz(e,t,a,i,r,I);for(let T of l.texts){", "visualizer in each frame")
bp.write_text(prefix + HEAD + json.dumps(box["s"]) + ";\n", encoding="utf-8")

# ---------------------------------------------------------------- the page around it
vp = folder / "video.js"
vbox = {"s": vp.read_text(encoding="utf-8")}
vrep = make_rep("video.js", lambda: vbox["s"], lambda v: vbox.__setitem__("s", v))
vrep("    <h3>Sound and file</h3>\n",
     '    <h3>Visualizer</h3>\n'
     '    <p class="muted m0">Moves with the song. It is drawn into the video you make, under the words and off the end card.</p>\n'
     '    ${chips("viz", "Visualizer", [["none", "None"], ["bars", "Bars"], ["wave", "Wave"], ["ring", "Ring"], ["glow", "Glow"]])}\n'
     '    <div class="ft-grid">\n'
     '      ${select("vizPos", "ft-viz-pos", "Position", [["bottom", "Bottom"], ["middle", "Middle"], ["top", "Top"]])}\n'
     '      ${range("vizSize", "ft-viz-size", "Size", 50, 200, 10)}\n'
     '      ${select("progress", "ft-progress", "Progress line", [["none", "None"], ["line", "Along the bottom"]])}\n'
     '    </div>\n'
     "    <h3>Sound and file</h3>\n", "visualizer controls")
vrep('.back{color:var(--muted);text-decoration:none;font-size:13px;border:1px solid var(--line2);padding:8px 14px;border-radius:999px}',
     '.back{color:var(--muted);text-decoration:none;font-size:13px;border:1px solid var(--line2);padding:8px 14px;border-radius:999px}\n'
     '.top-links{display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end}\n'
     '.stage-box{position:relative}.sz{position:absolute;pointer-events:none}.sz i{position:absolute;background:rgba(214,64,69,.26);box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}\n'
     '.sz .sz-t{left:0;right:0;top:0;height:12%}.sz .sz-b{left:0;right:0;bottom:0;height:22%}.sz .sz-r{right:0;top:12%;bottom:22%;width:14%}\n'
     '.sz-tog{display:flex;gap:8px;align-items:center;font-size:13px;margin:10px 0 0}.keys{font-size:12px;margin:6px 0 0}', "styles")
vrep('<a class="back" href="/">← Back to RB Command</a></header>',
     '<span class="top-links"><a class="back" href="https://relentlessbillionaire.com/create/" target="_blank" rel="noopener">RB Create ↗</a><a class="back" href="/cover">Cover maker</a><a class="back" href="/">← Back to RB Command</a></span></header>', "RB Create link")
vrep('<div class="stage-box"><canvas id="cv" width="270" height="480" aria-label="Video preview"></canvas></div>\n',
     '<div class="stage-box"><canvas id="cv" width="270" height="480" aria-label="Video preview"></canvas><div class="sz" id="sz" hidden aria-hidden="true"><i class="sz-t"></i><i class="sz-b"></i><i class="sz-r"></i></div></div>\n', "safe-zone layer")
vrep('<span id="time">0:00 / 0:00</span></div>\n',
     '<span id="time">0:00 / 0:00</span></div>\n'
     '  <label class="sz-tog" hidden><input id="sz-on" type="checkbox"> Shade where app buttons cover a 9:16 video <span class="muted">(preview only)</span></label>\n'
     '  <p class="muted keys">Space plays or pauses · ← → move one second</p>\n', "safe-zone toggle")
EXTRA = (
    '<script nonce="${nonce}">(function(){var cv=document.getElementById("cv"),sz=document.getElementById("sz"),on=document.getElementById("sz-on"),tog=on.parentNode;'
    'try{on.checked=localStorage.getItem("rb-video-safezone")==="1"}catch(e){}'
    'function place(){var f=document.querySelector("[data-fmt][aria-pressed=true]"),v=!!f&&f.dataset.fmt==="9:16";tog.hidden=!v;sz.hidden=!(v&&on.checked);if(sz.hidden)return;'
    'sz.style.left=cv.offsetLeft+"px";sz.style.top=cv.offsetTop+"px";sz.style.width=cv.offsetWidth+"px";sz.style.height=cv.offsetHeight+"px"}'
    'on.addEventListener("change",function(){try{localStorage.setItem("rb-video-safezone",on.checked?"1":"0")}catch(e){}place()});'
    'if(window.ResizeObserver)new ResizeObserver(place).observe(cv);var fm=document.querySelector(".fmt");if(fm)new MutationObserver(place).observe(fm,{subtree:true,attributes:true,attributeFilter:["aria-pressed"]});'
    'addEventListener("resize",place);place();'
    'document.addEventListener("keydown",function(e){var t=e.target;if(e.metaKey||e.ctrlKey||e.altKey||/^(INPUT|TEXTAREA|SELECT|BUTTON|SUMMARY|A|VIDEO)$/.test(t.tagName)||t.isContentEditable)return;'
    'if(e.key===" "){e.preventDefault();document.getElementById("play").click();return}'
    'if(e.key!=="ArrowLeft"&&e.key!=="ArrowRight")return;var s=document.getElementById("scrub"),q=(document.getElementById("time").textContent.split("/")[1]||"").trim().split(":"),d=q.length>1?+q[0]*60+ +q[1]:0;if(!d)return;'
    'e.preventDefault();s.value=String(Math.max(0,Math.min(1000,+s.value+(e.key==="ArrowRight"?1:-1)*1000/d)));s.dispatchEvent(new Event("input"))})})();</script>\n'
)
vrep('<script nonce="${nonce}">${EDITOR}</script>\n', '<script nonce="${nonce}">${EDITOR}</script>\n' + EXTRA, "safe zone and shortcuts")
vp.write_text(vbox["s"], encoding="utf-8")
print("rb-command: " + (", ".join(changed) + " updated" if changed else "video upgrades already in place"))
