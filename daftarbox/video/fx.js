/* Daftarbox Video Studio: GPU effects engine.
   Each clip's frame is uploaded to a WebGL texture, run through a chain of small fragment shaders
   (one per effect, some with two passes), and handed back as a canvas the editor draws like any image.
   Everything runs on the visitor's graphics card; nothing leaves the browser. */
"use strict";
(function () {
  /* ---------- Effect library ----------
     params: up to four numbers a, b, c, d.  px:true means the value is in pixels of a 1080-high frame
     (scaled to the real output so preview and export look the same).  cols: up to two colours k1, k2. */
  const P = (k, l, min, max, step, def, extra = {}) => ({k, l, min, max, step, def, ...extra});
  const LIB = [
    /* Blur & Sharpen */
    {id:"blur", name:"Gaussian Blur", cat:"Blur & Sharpen", params:[P("a", "Radius", 0, 60, 0.5, 8, {px:true})], passes:2, frag:`
      vec4 s=vec4(0.);float w=0.;for(int i=-8;i<=8;i++){float f=float(i);float g=exp(-f*f/24.);s+=T(v+dir*f*(a/8.)/r)*g;w+=g;}gl_FragColor=s/w;`},
    {id:"dblur", name:"Directional Blur", cat:"Blur & Sharpen", params:[P("a", "Length", 0, 120, 1, 20, {px:true}), P("b", "Angle", 0, 180, 1, 0, {u:"°"})], frag:`
      vec2 dd=vec2(cos(radians(b)),sin(radians(b)))*a/r;vec4 s=vec4(0.);for(int i=-8;i<=8;i++)s+=T(v+dd*float(i)/8.);gl_FragColor=s/17.;`},
    {id:"zblur", name:"Zoom Blur", cat:"Blur & Sharpen", params:[P("a", "Strength", 0, 1, 0.01, .3), P("c", "Centre X", 0, 1, 0.01, .5), P("d", "Centre Y", 0, 1, 0.01, .5)], frag:`
      vec2 cp=vec2(c,1.-d);vec4 s=vec4(0.);for(int i=0;i<20;i++)s+=T(cp+(v-cp)*(1.-a*.4*float(i)/19.));gl_FragColor=s/20.;`},
    {id:"sharpen", name:"Sharpen", cat:"Blur & Sharpen", params:[P("a", "Amount", 0, 3, 0.05, 1)], frag:`
      vec4 o=T(v);vec2 p=1./r;vec3 n=(T(v+vec2(p.x,0.)).rgb+T(v-vec2(p.x,0.)).rgb+T(v+vec2(0.,p.y)).rgb+T(v-vec2(0.,p.y)).rgb)*.25;
      gl_FragColor=vec4(clamp(o.rgb+(o.rgb-n)*a*2.,0.,1.),o.a);`},
    /* Colour */
    {id:"invert", name:"Invert Colour", cat:"Colour", params:[P("a", "Amount", 0, 1, 0.01, 1)], frag:`vec4 o=T(v);gl_FragColor=vec4(mix(o.rgb,1.-o.rgb,a),o.a);`},
    {id:"bw", name:"Black & White", cat:"Colour", params:[P("a", "Amount", 0, 1, 0.01, 1), P("b", "Contrast", 0.5, 2, 0.01, 1.1)], frag:`
      vec4 o=T(v);float l=(luma(o.rgb)-.5)*b+.5;gl_FragColor=vec4(mix(o.rgb,vec3(clamp(l,0.,1.)),a),o.a);`},
    {id:"tint", name:"Tint", cat:"Colour", params:[P("a", "Amount", 0, 1, 0.01, .6)], cols:[{k:"k1", l:"Colour", def:"#ff9a3c"}], frag:`
      vec4 o=T(v);float l=luma(o.rgb);vec3 tc=k1/max(max(k1.r,k1.g),max(k1.b,.01));gl_FragColor=vec4(mix(o.rgb,clamp(vec3(l)*tc*1.15,0.,1.),a),o.a);`},
    {id:"duotone", name:"Duotone", cat:"Colour", params:[P("a", "Amount", 0, 1, 0.01, 1)], cols:[{k:"k1", l:"Shadows", def:"#1b1464"}, {k:"k2", l:"Highlights", def:"#ffd54a"}], frag:`
      vec4 o=T(v);gl_FragColor=vec4(mix(o.rgb,mix(k1,k2,smoothstep(0.,1.,luma(o.rgb))),a),o.a);`},
    {id:"posterize", name:"Posterize", cat:"Colour", params:[P("a", "Levels", 2, 16, 1, 5)], frag:`
      vec4 o=T(v);gl_FragColor=vec4(floor(o.rgb*(a-1.)+.5)/(a-1.),o.a);`},
    {id:"threshold", name:"Threshold", cat:"Colour", params:[P("a", "Level", 0, 1, 0.01, .5)], cols:[{k:"k1", l:"Dark", def:"#000000"}, {k:"k2", l:"Light", def:"#ffffff"}], frag:`
      vec4 o=T(v);gl_FragColor=vec4(mix(k1,k2,step(a,luma(o.rgb))),o.a);`},
    /* Distort */
    {id:"magnify", name:"Magnify / Pinch", cat:"Distort", params:[P("a", "Strength", -1, 0.9, 0.01, .5), P("b", "Radius", 0.05, 1, 0.01, .35), P("c", "Centre X", 0, 1, 0.01, .5), P("d", "Centre Y", 0, 1, 0.01, .5)], frag:`
      vec2 cp=vec2(c,1.-d);vec2 dv=v-cp;float asp=r.x/r.y;vec2 q=vec2(dv.x*asp,dv.y);float dist=length(q);vec2 uv=v;
      if(dist<b){float p=dist/b;uv=cp+dv*(1.-a*(1.-p)*(1.-p));}gl_FragColor=T(uv);`},
    {id:"twirl", name:"Twirl", cat:"Distort", params:[P("a", "Angle", -720, 720, 5, 180, {u:"°"}), P("b", "Radius", 0.05, 1, 0.01, .4), P("c", "Centre X", 0, 1, 0.01, .5), P("d", "Centre Y", 0, 1, 0.01, .5)], frag:`
      vec2 cp=vec2(c,1.-d);float asp=r.x/r.y;vec2 q=(v-cp)*vec2(asp,1.);float dist=length(q);
      if(dist<b){float p=(b-dist)/b;float an=radians(a)*p*p;float s=sin(an),co=cos(an);q=vec2(co*q.x-s*q.y,s*q.x+co*q.y);}
      gl_FragColor=T(cp+q/vec2(asp,1.));`},
    {id:"wave", name:"Wave / Ripple", cat:"Distort", params:[P("a", "Size", 0, 1, 0.01, .3), P("b", "Frequency", 1, 40, 0.5, 8), P("c", "Speed", 0, 5, 0.1, 1)], frag:`
      vec2 uv=v+vec2(sin(v.y*b*6.2832+time*c*6.)*a*.03,cos(v.x*b*6.2832+time*c*6.)*a*.03);gl_FragColor=T(uv);`},
    {id:"heat", name:"Heat Distortion", cat:"Distort", params:[P("a", "Amount", 0, 1, 0.01, .4)], frag:`
      float n=sin(v.y*70.+time*9.)*.5+sin(v.y*31.-time*6.+v.x*12.)*.5;gl_FragColor=T(v+vec2(n*a*.006,n*a*.003));`},
    {id:"mirror", name:"Mirror", cat:"Distort", params:[P("a", "Mode", 0, 3, 1, 0, {opts:["Left → right", "Right → left", "Top → bottom", "Four ways"]})], frag:`
      vec2 uv=v;if(a<.5)uv.x=v.x<.5?v.x:1.-v.x;else if(a<1.5)uv.x=v.x>.5?v.x:1.-v.x;else if(a<2.5)uv.y=v.y>.5?v.y:1.-v.y;else uv=vec2(v.x<.5?v.x:1.-v.x,v.y>.5?v.y:1.-v.y);gl_FragColor=T(uv);`},
    {id:"kaleido", name:"Kaleidoscope", cat:"Distort", params:[P("a", "Segments", 2, 16, 1, 6), P("b", "Rotate", 0, 360, 1, 0, {u:"°"})], frag:`
      float asp=r.x/r.y;vec2 q=(v-.5)*vec2(asp,1.);float an=atan(q.y,q.x)+radians(b);float rr=length(q);float sg=6.2832/a;
      an=mod(an,sg);an=abs(an-sg*.5);q=vec2(cos(an),sin(an))*rr;gl_FragColor=T(q/vec2(asp,1.)+.5);`},
    {id:"pixelate", name:"Pixelate / Mosaic", cat:"Distort", params:[P("a", "Block size", 2, 120, 1, 20, {px:true})], frag:`
      vec2 bs=vec2(a)/r;gl_FragColor=T((floor(v/bs)+.5)*bs);`},
    {id:"tiler", name:"Tiler", cat:"Distort", params:[P("a", "Tiles", 1, 8, 1, 2)], frag:`gl_FragColor=T(fract(v*a));`},
    /* Stylize */
    {id:"glow", name:"Glow", cat:"Stylize", params:[P("a", "Radius", 1, 60, 1, 18, {px:true}), P("b", "Intensity", 0, 3, 0.05, 1), P("c", "Threshold", 0, 1, 0.01, .55)], frag:`
      vec4 o=T(v);vec3 s=vec3(0.);for(int i=0;i<24;i++){float fi=float(i);float an=fi*2.39996;float rd=sqrt((fi+.5)/24.)*a;s+=max(T(v+vec2(cos(an),sin(an))*rd/r).rgb-c,0.);}
      gl_FragColor=vec4(clamp(o.rgb+s/24.*b*2.5,0.,1.),o.a);`},
    {id:"vignette", name:"Vignette", cat:"Stylize", params:[P("a", "Amount", 0, 1, 0.01, .6), P("b", "Softness", 0, 1, 0.01, .5)], frag:`
      vec4 o=T(v);vec2 q=(v-.5)*vec2(r.x/r.y*.75,1.);float dd=length(q);float f=1.-a*smoothstep(.28,.3+.6*b,dd);gl_FragColor=vec4(o.rgb*f,o.a);`},
    {id:"grain", name:"Film Grain", cat:"Stylize", params:[P("a", "Amount", 0, 1, 0.01, .25)], frag:`
      vec4 o=T(v);float n=hash(floor(v*r)+fract(time*24.)*91.7)-.5;gl_FragColor=vec4(clamp(o.rgb+n*a*.6,0.,1.),o.a);`},
    {id:"scanlines", name:"Scanlines", cat:"Stylize", params:[P("a", "Amount", 0, 1, 0.01, .35), P("b", "Spacing", 2, 12, 1, 4, {px:true})], frag:`
      vec4 o=T(v);float s=sin(v.y*r.y*3.1416/b)*.5+.5;gl_FragColor=vec4(o.rgb*(1.-a*(1.-s)),o.a);`},
    {id:"chromab", name:"Chromatic Aberration", cat:"Stylize", params:[P("a", "Offset", 0, 30, 0.5, 6, {px:true})], frag:`
      vec2 off=(v-.5)*2.*a/r;vec4 o=T(v);gl_FragColor=vec4(T(v+off).r,o.g,T(v-off).b,o.a);`},
    {id:"halftone", name:"Halftone", cat:"Stylize", params:[P("a", "Dot size", 4, 40, 1, 10, {px:true}), P("b", "Colour dots", 0, 1, 1, 0, {opts:["Black", "Colour"]})], frag:`
      vec2 cs=vec2(a)/r;vec2 cen=(floor(v/cs)+.5)*cs;vec4 cc=T(cen);float l=luma(cc.rgb);float rad=a*.5*sqrt(1.-l)*1.25;
      float dt=1.-smoothstep(rad-1.,rad+.5,length((v-cen)*r));gl_FragColor=vec4(mix(vec3(1.),mix(vec3(0.),cc.rgb,b),dt),cc.a);`},
    {id:"emboss", name:"Emboss", cat:"Stylize", params:[P("a", "Strength", 0, 4, 0.05, 1.5), P("b", "Keep colour", 0, 1, 0.01, 0)], frag:`
      vec2 p=1./r;vec4 o=T(v);float e=luma(T(v-p).rgb)-luma(T(v+p).rgb);vec3 em=vec3(.5+e*a*2.);gl_FragColor=vec4(mix(em,o.rgb*(em*2.),b),o.a);`},
    {id:"edges", name:"Find Edges", cat:"Stylize", params:[P("a", "Strength", 0, 4, 0.05, 1.5), P("b", "Style", 0, 1, 1, 0, {opts:["Dark lines on white", "Glowing lines"]})], frag:`
      vec2 p=1./r;float tl=luma(T(v+vec2(-p.x,p.y)).rgb),tt=luma(T(v+vec2(0.,p.y)).rgb),tr=luma(T(v+p).rgb),ml=luma(T(v-vec2(p.x,0.)).rgb),mr=luma(T(v+vec2(p.x,0.)).rgb),bl=luma(T(v-p).rgb),bb=luma(T(v-vec2(0.,p.y)).rgb),br=luma(T(v+vec2(p.x,-p.y)).rgb);
      float gx=-tl-2.*ml-bl+tr+2.*mr+br,gy=-tl-2.*tt-tr+bl+2.*bb+br;float m=clamp(length(vec2(gx,gy))*a,0.,1.);gl_FragColor=vec4(b<.5?vec3(1.-m):vec3(m)*T(v).rgb*2.,T(v).a);`},
    {id:"cartoon", name:"Cartoon", cat:"Stylize", params:[P("a", "Colour levels", 2, 12, 1, 5), P("b", "Outlines", 0, 3, 0.05, 1.2)], frag:`
      vec2 p=1./r;vec4 o=T(v);vec3 q=floor(o.rgb*(a-1.)+.5)/(a-1.);
      float gx=luma(T(v+vec2(p.x,0.)).rgb)-luma(T(v-vec2(p.x,0.)).rgb),gy=luma(T(v+vec2(0.,p.y)).rgb)-luma(T(v-vec2(0.,p.y)).rgb);
      float e=smoothstep(.08,.25,length(vec2(gx,gy))*b);gl_FragColor=vec4(q*(1.-e),o.a);`},
    {id:"glitch", name:"Pixel Glitch", cat:"Stylize", params:[P("a", "Amount", 0, 1, 0.01, .5), P("b", "Speed", 1, 30, 1, 10)], frag:`
      float tt=floor(time*b);float row=floor(v.y*24.);float rn=hash(vec2(row,tt));float sh=rn>1.-a*.6?(hash(vec2(tt,row))-.5)*a*.25:0.;
      vec2 uv=vec2(fract(v.x+sh),v.y);float o2=a*.012;vec4 o=T(uv);gl_FragColor=vec4(T(uv+vec2(o2,0.)).r,o.g,T(uv-vec2(o2,0.)).b,o.a);`},
    {id:"nightvision", name:"Night Vision", cat:"Stylize", params:[P("a", "Intensity", 0, 1, 0.01, .8)], frag:`
      vec4 o=T(v);float l=luma(o.rgb)*1.7+(hash(floor(v*r)+fract(time*30.)*57.)-.5)*.25;vec3 g=vec3(.12,1.,.25)*l;
      float vg=1.-smoothstep(.35,.62,length((v-.5)*vec2(r.x/r.y,1.)));float sc=.9+.1*sin(v.y*r.y*1.6);gl_FragColor=vec4(mix(o.rgb,clamp(g*vg*sc,0.,1.),a),o.a);`},
    {id:"cctv", name:"CCTV Camera", cat:"Stylize", params:[P("a", "Noise", 0, 1, 0.01, .4)], frag:`
      vec4 o=T(v);float l=luma(o.rgb)*1.1;l+=(hash(floor(v*r*.5)+fract(time*25.)*33.)-.5)*a*.35;l*=.88+.12*sin(v.y*r.y*1.2+time*40.);
      gl_FragColor=vec4(clamp(vec3(l*.92,l,l*.9),0.,1.),o.a);`},
    {id:"oldfilm", name:"Old Film", cat:"Stylize", params:[P("a", "Amount", 0, 1, 0.01, .8)], frag:`
      vec4 o=T(v);float l=luma(o.rgb);vec3 sp=vec3(l*1.07,l*.86,l*.62);float fl=.92+.08*hash(vec2(floor(time*18.),3.));
      float gn=(hash(floor(v*r)+fract(time*24.)*77.)-.5)*.22;float sx=hash(vec2(floor(time*8.),1.));float scr=step(.997,1.-abs(v.x-sx)*80.)*step(.4,hash(vec2(floor(time*8.),9.)));
      float vg=1.-.55*smoothstep(.3,.75,length((v-.5)*vec2(r.x/r.y*.8,1.)));vec3 f=clamp((sp*fl+gn)*vg+scr*.5,0.,1.);gl_FragColor=vec4(mix(o.rgb,f,a),o.a);`},
    {id:"spotlight", name:"Spotlight", cat:"Light", params:[P("a", "Darkness", 0, 1, 0.01, .7), P("b", "Size", 0.05, 1.5, 0.01, .45), P("c", "Centre X", 0, 1, 0.01, .5), P("d", "Centre Y", 0, 1, 0.01, .5)], frag:`
      vec4 o=T(v);float dd=length((v-vec2(c,1.-d))*vec2(r.x/r.y,1.));float f=1.-smoothstep(b*.5,b*.5+.18,dd);gl_FragColor=vec4(o.rgb*mix(1.-a,1.,f),o.a);`},
    {id:"lightleak", name:"Light Leak", cat:"Light", params:[P("a", "Amount", 0, 1, 0.01, .55), P("b", "Drift", 0, 2, 0.05, .5)], cols:[{k:"k1", l:"Colour", def:"#ff7a2f"}], frag:`
      vec4 o=T(v);vec2 cp=vec2(.15+.3*sin(time*b*.7),.85+.1*cos(time*b));float dd=length((v-cp)*vec2(r.x/r.y,1.));float f=exp(-dd*dd*4.)*a;
      gl_FragColor=vec4(1.-(1.-o.rgb)*(1.-k1*f),o.a);`},
    /* Keying */
    {id:"chromakey", name:"Green Screen (Chroma Key)", cat:"Keying", params:[P("a", "Similarity", 0, 1, 0.005, .4), P("b", "Smoothness", 0, 1, 0.005, .15), P("c", "Spill removal", 0, 1, 0.01, .5)], cols:[{k:"k1", l:"Key colour", def:"#00b140", pick:true}], frag:`
      vec4 o=T(v);vec2 ck=vec2(dot(o.rgb,vec3(-.169,-.331,.5)),dot(o.rgb,vec3(.5,-.419,-.081)));vec2 kk=vec2(dot(k1,vec3(-.169,-.331,.5)),dot(k1,vec3(.5,-.419,-.081)));
      float dd=distance(ck,kk);float lo=a*.45;float al=smoothstep(lo,lo+b*.35+.002,dd);
      float sp=(1.-smoothstep(lo,lo+b*.35+.25,dd))*c;vec3 col=mix(o.rgb,vec3(luma(o.rgb)),sp);gl_FragColor=vec4(col,o.a*al);`},
    {id:"lumakey", name:"Luma Key", cat:"Keying", params:[P("a", "Threshold", 0, 1, 0.01, .2), P("b", "Softness", 0, 1, 0.01, .1), P("c", "Remove", 0, 1, 1, 0, {opts:["Dark areas", "Bright areas"]})], frag:`
      vec4 o=T(v);float l=luma(o.rgb);float al=smoothstep(a-b*.5,a+b*.5+.001,l);if(c>.5)al=1.-al;gl_FragColor=vec4(o.rgb,o.a*al);`}
  ];
  const byId = Object.fromEntries(LIB.map(e => [e.id, e]));
  const CATS = [...new Set(LIB.map(e => e.cat))];

  /* ---------- WebGL plumbing ---------- */
  const HEAD = `precision highp float;varying vec2 v;uniform sampler2D t;uniform vec2 r,dir;uniform float time,a,b,c,d;uniform vec3 k1,k2;uniform vec4 crop;
    vec4 T(vec2 u){return texture2D(t,clamp(u,0.,1.));}float luma(vec3 x){return dot(x,vec3(.299,.587,.114));}
    float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}`;
  const VERT = `attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
  let gl = null, cv = null, buf = null, srcTex = null, fbos = [], fw = 0, fh = 0, failed = false;
  const progs = {};
  function init() {
    if (gl || failed) return !!gl;
    try {
      cv = document.createElement("canvas"); cv.width = cv.height = 2;
      gl = cv.getContext("webgl", {premultipliedAlpha:true, alpha:true, preserveDrawingBuffer:true, antialias:false});
      if (!gl) throw new Error("no webgl");
      buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      srcTex = makeTex();
      cv.addEventListener("webglcontextlost", e => { e.preventDefault(); gl = null; failed = false; Object.keys(progs).forEach(k => delete progs[k]); fbos = []; fw = fh = 0; });
      return true;
    } catch (e) { failed = true; gl = null; return false; }
  }
  function makeTex() {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(p => gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }
  function sizeFbos(w, h) {
    if (fw === w && fh === h && fbos.length) return;
    fbos.forEach(f => { gl.deleteTexture(f.tex); gl.deleteFramebuffer(f.fb); });
    fbos = [0, 1].map(() => {
      const tex = makeTex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      return {tex, fb};
    });
    fw = w; fh = h;
  }
  function prog(key, body) {
    if (progs[key] !== undefined) return progs[key];
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error("Effect shader", key, gl.getShaderInfoLog(s)); return null; } return s; };
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, HEAD + "void main(){" + body + "}");
    if (!vs || !fs) return (progs[key] = null);
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error("Effect link", key, gl.getProgramInfoLog(p)); return (progs[key] = null); }
    const u = {}; ["t", "r", "dir", "time", "a", "b", "c", "d", "k1", "k2", "crop"].forEach(n => { u[n] = gl.getUniformLocation(p, n); });
    return (progs[key] = {p, u});
  }
  const hex = h => { const n = parseInt(String(h || "#000000").slice(1), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  function draw(pr, tex, fb, w, h, uni) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h);
    gl.useProgram(pr.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(pr.u.t, 0); gl.uniform2f(pr.u.r, w, h);
    for (const k in uni) { const loc = pr.u[k]; if (!loc) continue; const val = uni[k]; if (val.length === 4) gl.uniform4fv(loc, val); else if (val.length === 3) gl.uniform3fv(loc, val); else if (val.length === 2) gl.uniform2fv(loc, val); else gl.uniform1f(loc, val); }
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  const COPY = `gl_FragColor=texture2D(t,crop.xy+v*crop.zw);`, OUT = `vec4 o=T(v);gl_FragColor=vec4(o.rgb*o.a,o.a);`;

  /* Run `list` (the clip's effects) over source rectangle (sx,sy,sw,sh) of `src`, producing a w×h canvas.
     unit = output frame height / 1080, so pixel-sized settings look the same at every resolution. */
  /* ---------- Colour grade pass (runs after the clip's effects) ----------
     g = {exp, con, hi, sh, sat, vib, temp, tnt, hue, lift:[r,g,b], gam:[r,g,b], gain:[r,g,b], lut:id|null, lamt} */
  const GRADE = `uniform float exp_,con,hi,shd,sat,vib,tmp,tnt,hue,lsz,lamt;uniform vec3 lift,gam,gain;uniform sampler2D tl;
    vec3 lutAt(vec3 c){float n=lsz;c=clamp(c,0.,1.)*(n-1.);float b0=floor(c.b),b1=min(b0+1.,n-1.),f=c.b-b0;
      vec2 u0=vec2((b0*n+c.r+.5)/(n*n),(c.g+.5)/n),u1=vec2((b1*n+c.r+.5)/(n*n),(c.g+.5)/n);return mix(texture2D(tl,u0).rgb,texture2D(tl,u1).rgb,f);}
    void main(){vec4 o=T(v);vec3 c=o.rgb*pow(2.,exp_);
      c*=vec3(1.+.12*tmp+.04*tnt,1.-.08*tnt,1.-.12*tmp+.04*tnt);
      c=gain*(c+lift*(1.-c));c=pow(max(c,0.),1./max(gam,.05));
      float l=luma(c);c+=hi*smoothstep(.45,1.,l)*.45+shd*(1.-smoothstep(0.,.55,l))*.45;
      c=(c-.5)*(1.+con)+.5;
      l=luma(c);c=mix(vec3(l),c,sat);float mx=max(c.r,max(c.g,c.b)),mn=min(c.r,min(c.g,c.b));c=mix(vec3(l),c,1.+vib*(1.-(mx-mn)));
      if(hue!=0.){float an=radians(hue);mat3 toY=mat3(.299,.596,.211,.587,-.274,-.523,.114,-.322,.312);mat3 fromY=mat3(1.,1.,1.,.956,-.272,-1.106,.621,-.647,1.703);vec3 y=toY*c;float cs=cos(an),sn=sin(an);y=vec3(y.x,y.y*cs-y.z*sn,y.y*sn+y.z*cs);c=fromY*y;}
      c=clamp(c,0.,1.);if(lamt>0.)c=mix(c,lutAt(c),lamt);gl_FragColor=vec4(c,o.a);}`;
  let gradeP = null, lutTex = {}, blankLut = null;
  function gradeProg() {
    if (gradeP) return gradeP;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error("Grade shader", gl.getShaderInfoLog(s)); return null; } return s; };
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, HEAD + GRADE); if (!vs || !fs) return null;
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error("Grade link", gl.getProgramInfoLog(p)); return null; }
    const u = {}; ["t", "r", "tl", "exp_", "con", "hi", "shd", "sat", "vib", "tmp", "tnt", "hue", "lsz", "lamt", "lift", "gam", "gain"].forEach(n => { u[n] = gl.getUniformLocation(p, n); });
    return (gradeP = {p, u});
  }
  /* Upload a 3D LUT (N×N×N, RGB floats 0..1, red fastest) as an (N·N)×N strip texture. */
  function setLut(id, n, rgb) {
    if (!init()) return false;
    const data = new Uint8Array(n * n * n * 4);
    for (let b = 0; b < n; b++) for (let g2 = 0; g2 < n; g2++) for (let r2 = 0; r2 < n; r2++) {
      const i = r2 + g2 * n + b * n * n, x = b * n + r2, y = g2, o = (y * n * n + x) * 4;
      data[o] = Math.round(Math.min(1, Math.max(0, rgb[i * 3])) * 255); data[o + 1] = Math.round(Math.min(1, Math.max(0, rgb[i * 3 + 1])) * 255); data[o + 2] = Math.round(Math.min(1, Math.max(0, rgb[i * 3 + 2])) * 255); data[o + 3] = 255;
    }
    const t = lutTex[id] ? lutTex[id].tex : makeTex();
    gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n * n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    lutTex[id] = {tex:t, n}; return true;
  }
  function gradePass(src, dstFb, w, h, gr) {
    const pr = gradeProg(); if (!pr) return false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstFb); gl.viewport(0, 0, w, h); gl.useProgram(pr.p);
    if (!blankLut) { gl.activeTexture(gl.TEXTURE1); blankLut = makeTex(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255])); }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src); gl.uniform1i(pr.u.t, 0);
    const L = gr.lut && lutTex[gr.lut];
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, L ? L.tex : blankLut); gl.uniform1i(pr.u.tl, 1);
    gl.uniform2f(pr.u.r, w, h);
    const f = (k, v) => gl.uniform1f(pr.u[k], v);
    f("exp_", gr.exp || 0); f("con", gr.con || 0); f("hi", gr.hi || 0); f("shd", gr.sh || 0); f("sat", gr.sat ?? 1); f("vib", gr.vib || 0);
    f("tmp", gr.temp || 0); f("tnt", gr.tnt || 0); f("hue", gr.hue || 0); f("lsz", L ? L.n : 2); f("lamt", L ? (gr.lamt ?? 1) : 0);
    gl.uniform3fv(pr.u.lift, gr.lift || [0, 0, 0]); gl.uniform3fv(pr.u.gam, gr.gam || [1, 1, 1]); gl.uniform3fv(pr.u.gain, gr.gain || [1, 1, 1]);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); gl.activeTexture(gl.TEXTURE0);
    return true;
  }

  function render(src, srcW, srcH, sx, sy, sw, sh, w, h, list, time, unit, grade) {
    const active = (list || []).filter(e => e && e.on !== false && byId[e.id]);
    if ((!active.length && !grade) || !init()) return null;
    w = Math.max(1, Math.min(2048, Math.round(w))); h = Math.max(1, Math.min(2048, Math.round(h)));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    sizeFbos(w, h);
    gl.disable(gl.BLEND);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch (e) { return null; }
    const cp = prog("_copy", COPY), crop = [sx / srcW, 1 - (sy + sh) / srcH, sw / srcW, sh / srcH];
    if (!cp) return null;
    draw(cp, srcTex, fbos[0].fb, w, h, {crop});
    let cur = 0;
    for (const e of active) {
      const def = byId[e.id], pr = prog(def.id, def.frag); if (!pr) continue;
      const uni = {time:time || 0};
      for (const p of def.params) { let val = +(e[p.k] ?? p.def); if (p.px) val *= unit || 1; uni[p.k] = val; }
      (def.cols || []).forEach(cdef => { uni[cdef.k] = hex(e[cdef.k] || cdef.def); });
      const passes = def.passes || 1;
      for (let i = 0; i < passes; i++) {
        uni.dir = passes === 2 ? (i === 0 ? [1, 0] : [0, 1]) : [1, 0];
        draw(pr, fbos[cur].tex, fbos[1 - cur].fb, w, h, uni); cur = 1 - cur;
      }
    }
    if (grade && gradePass(fbos[cur].tex, fbos[1 - cur].fb, w, h, grade)) cur = 1 - cur;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    draw(prog("_out", OUT), fbos[cur].tex, null, w, h, {});
    return cv;
  }
  function defaults(id) {
    const d = byId[id]; if (!d) return null;
    const e = {id, on:true}; d.params.forEach(p => { e[p.k] = p.def; }); (d.cols || []).forEach(cdef => { e[cdef.k] = cdef.def; });
    return e;
  }
  /* ---------- Transitions ----------
     A = outgoing clip, B = incoming clip, each already drawn full-frame (with its own position, crop and effects).
     p goes 0 → 1 over the transition. Bodies only use A(), B(), v, p, r, time, asp and the helpers below. */
  const TR = [
    /* Fades */
    {id:"dissolve", name:"Cross Dissolve", cat:"Fades", f:`gl_FragColor=mix(A(v),B(v),p);`},
    {id:"smoothcut", name:"Smooth Cut", cat:"Fades", f:`gl_FragColor=mix(A(v),B(v),smoothstep(.35,.65,p));`},
    {id:"black", name:"Dip to Black", cat:"Fades", f:`vec4 c=p<.5?A(v):B(v);gl_FragColor=mix(c,vec4(0.,0.,0.,1.),1.-abs(p*2.-1.));`},
    {id:"white", name:"Dip to White", cat:"Fades", f:`vec4 c=p<.5?A(v):B(v);gl_FragColor=mix(c,vec4(1.),1.-abs(p*2.-1.));`},
    {id:"additive", name:"Additive Dissolve", cat:"Fades", f:`vec4 a=A(v),b=B(v);gl_FragColor=vec4(clamp(a.rgb*min(1.,2.-2.*p)+b.rgb*min(1.,2.*p),0.,1.),max(a.a,b.a));`},
    {id:"blurdis", name:"Blur Dissolve", cat:"Fades", f:`float bl=sin(3.1416*p)*14.;vec4 a=vec4(0.),b=vec4(0.);for(int i=-4;i<=4;i++)for(int j=-4;j<=4;j++){vec2 o=vec2(float(i),float(j))*bl/4./r;a+=A(v+o);b+=B(v+o);}gl_FragColor=mix(a,b,p)/81.;`},
    /* Wipes */
    {id:"wipe", name:"Wipe Right", cat:"Wipes", f:`gl_FragColor=mix(A(v),B(v),1.-smoothstep(p-.01,p+.01,v.x*1.02-.01));`},
    {id:"wipeleft", name:"Wipe Left", cat:"Wipes", f:`gl_FragColor=mix(A(v),B(v),1.-smoothstep(p-.01,p+.01,(1.-v.x)*1.02-.01));`},
    {id:"wipeup", name:"Wipe Up", cat:"Wipes", f:`gl_FragColor=mix(A(v),B(v),1.-smoothstep(p-.01,p+.01,v.y*1.02-.01));`},
    {id:"wipedown", name:"Wipe Down", cat:"Wipes", f:`gl_FragColor=mix(A(v),B(v),1.-smoothstep(p-.01,p+.01,(1.-v.y)*1.02-.01));`},
    {id:"softwipe", name:"Soft Wipe", cat:"Wipes", f:`float e=p*1.3-.15;gl_FragColor=mix(A(v),B(v),1.-smoothstep(e-.15,e+.15,v.x));`},
    {id:"diagwipe", name:"Diagonal Wipe", cat:"Wipes", f:`float e=p*1.1-.05;gl_FragColor=mix(A(v),B(v),1.-smoothstep(e-.03,e+.03,(v.x+(1.-v.y))*.5));`},
    {id:"barn", name:"Barn Doors", cat:"Wipes", f:`gl_FragColor=abs(v.x-.5)*2.<p?B(v):A(v);`},
    {id:"barnv", name:"Barn Doors Vertical", cat:"Wipes", f:`gl_FragColor=abs(v.y-.5)*2.<p?B(v):A(v);`},
    {id:"iris", name:"Iris", cat:"Wipes", f:`float d=length((v-.5)*vec2(asp,1.));float m=p*length(vec2(asp,1.))*.5;gl_FragColor=mix(A(v),B(v),1.-smoothstep(m-.01,m+.01,d));`},
    {id:"diamond", name:"Diamond", cat:"Wipes", f:`float d=abs(v.x-.5)*asp+abs(v.y-.5);gl_FragColor=d<p*(asp*.5+.5)?B(v):A(v);`},
    {id:"clock", name:"Clock Wipe", cat:"Wipes", f:`vec2 q=v-.5;float an=atan(q.x,q.y)/6.2832+.5;gl_FragColor=an<p?B(v):A(v);`},
    {id:"blinds", name:"Venetian Blinds", cat:"Wipes", f:`gl_FragColor=fract(v.y*10.)<p?B(v):A(v);`},
    {id:"curtain", name:"Curtain Call", cat:"Wipes", f:`float q=ease(p);if(v.x<.5){float sx=v.x+q*.5;gl_FragColor=sx<.5?A(vec2(sx,v.y)):B(v);}else{float sx=v.x-q*.5;gl_FragColor=sx>=.5?A(vec2(sx,v.y)):B(v);}`},
    {id:"dots", name:"Dots", cat:"Wipes", f:`vec2 q=v*vec2(asp,1.)*10.;float d=length(fract(q)-.5);gl_FragColor=d<p*.75?B(v):A(v);`},
    {id:"checker", name:"Checkerboard", cat:"Wipes", f:`vec2 c=floor(v*vec2(asp,1.)*6.);float par=mod(c.x+c.y,2.);gl_FragColor=p*2.>par+fract(v.x*asp*6.)?B(v):A(v);`},
    {id:"blocks", name:"Random Blocks", cat:"Wipes", f:`float k=rnd(floor(v*vec2(16.,9.)));gl_FragColor=p>k?B(v):A(v);`},
    /* Slide & push */
    {id:"slide", name:"Push Left", cat:"Slide & Push", f:`float q=ease(p);gl_FragColor=v.x<1.-q?A(v+vec2(q,0.)):B(v-vec2(1.-q,0.));`},
    {id:"pushright", name:"Push Right", cat:"Slide & Push", f:`float q=ease(p);gl_FragColor=v.x>q?A(v-vec2(q,0.)):B(v+vec2(1.-q,0.));`},
    {id:"pushup", name:"Push Up", cat:"Slide & Push", f:`float q=ease(p);gl_FragColor=v.y>q?A(v-vec2(0.,q)):B(v+vec2(0.,1.-q));`},
    {id:"pushdown", name:"Push Down", cat:"Slide & Push", f:`float q=ease(p);gl_FragColor=v.y<1.-q?A(v+vec2(0.,q)):B(v-vec2(0.,1.-q));`},
    {id:"cover", name:"Slide In (cover)", cat:"Slide & Push", f:`float q=ease(p);gl_FragColor=v.x>1.-q?B(v-vec2(1.-q,0.)):A(v);`},
    {id:"reveal", name:"Slide Out (reveal)", cat:"Slide & Push", f:`float q=ease(p);gl_FragColor=v.x<1.-q?A(v+vec2(q,0.)):B(v);`},
    {id:"whip", name:"Whip Pan", cat:"Slide & Push", f:`float q=ease(p);float bl=sin(3.1416*p)*.08;vec4 s=vec4(0.);for(int i=-6;i<=6;i++){vec2 u=v+vec2(float(i)*bl/6.,0.);s+=u.x<1.-q?A(u+vec2(q,0.)):B(u-vec2(1.-q,0.));}gl_FragColor=s/13.;`},
    {id:"bounce", name:"Bounce In", cat:"Slide & Push", f:`float x=p-1.;float q=1.+2.70158*x*x*x+1.70158*x*x;gl_FragColor=v.x>1.-q?B(v-vec2(1.-q,0.)):A(v);`},
    /* Zoom */
    {id:"zoom", name:"Zoom In", cat:"Zoom", f:`vec4 a=A(.5+(v-.5)/(1.+p*1.5));vec4 b=B(.5+(v-.5)/(.6+.4*p));gl_FragColor=mix(a,b,smoothstep(.2,.8,p));`},
    {id:"zoomout", name:"Zoom Out", cat:"Zoom", f:`vec4 a=A(.5+(v-.5)*(1.+p*1.5));vec4 b=B(.5+(v-.5)/(1.+(1.-p)*1.2));gl_FragColor=mix(a,b,smoothstep(.2,.8,p));`},
    {id:"crosszoom", name:"Cross Zoom", cat:"Zoom", f:`float st=sin(3.1416*p)*.35;vec4 a=vec4(0.),b=vec4(0.);for(int i=0;i<16;i++){float s=1.-st*float(i)/15.;a+=A(.5+(v-.5)*s);b+=B(.5+(v-.5)*s);}gl_FragColor=mix(a,b,smoothstep(.3,.7,p))/16.;`},
    {id:"spin", name:"Rotation Zoom", cat:"Zoom", f:`float q=ease(p);vec2 c=(v-.5)*vec2(asp,1.);float an=q*6.2832;float s=1.+sin(3.1416*q)*2.;c=mat2(cos(an),-sin(an),sin(an),cos(an))*c*s;vec2 u=c/vec2(asp,1.)+.5;gl_FragColor=q<.5?Ac(u):Bc(u);`},
    {id:"pixelzoom", name:"Pixelate", cat:"Zoom", f:`float bs=max(1.,sin(3.1416*p)*60.);vec2 cell=vec2(bs)/r;vec2 u=(floor(v/cell)+.5)*cell;gl_FragColor=p<.5?A(u):B(u);`},
    /* Light & blur */
    {id:"flash", name:"Flash", cat:"Light & Blur", f:`vec4 c=mix(A(v),B(v),smoothstep(.45,.55,p));float fl=exp(-abs(p-.5)*14.);gl_FragColor=vec4(mix(c.rgb,vec3(1.),fl),max(c.a,fl));`},
    {id:"burn", name:"Film Burn", cat:"Light & Blur", f:`float n=rnd(floor(v*vec2(40.,22.)))*.25;float e=p*1.4-.2+n;float m=smoothstep(e-.2,e+.2,v.x+v.y*.3);vec4 c=mix(B(v),A(v),m);float g=(1.-abs(m*2.-1.))*sin(3.1416*p);gl_FragColor=vec4(clamp(c.rgb+vec3(1.,.55,.15)*g*1.4,0.,1.),c.a);`},
    {id:"leak", name:"Light Leak", cat:"Light & Blur", f:`vec4 c=mix(A(v),B(v),smoothstep(.3,.7,p));vec2 cp=vec2(-.2+p*1.4,.7);float d=length((v-cp)*vec2(asp,1.));float g=exp(-d*d*3.)*sin(3.1416*p)*1.2;gl_FragColor=vec4(1.-(1.-c.rgb)*(1.-vec3(1.,.5,.2)*g),c.a);`},
    {id:"blink", name:"Blink", cat:"Light & Blur", f:`float q=1.-abs(p*2.-1.);float lid=abs(v.y-.5)*2.;vec4 c=p<.5?A(v):B(v);gl_FragColor=lid>1.-q*1.05?vec4(0.,0.,0.,1.):c;`},
    /* Distort */
    {id:"ripple", name:"Ripple", cat:"Distort", f:`vec2 q=(v-.5)*vec2(asp,1.);float d=length(q);float amp=sin(3.1416*p)*.03;vec2 u=v+normalize(q+1e-5)*sin(d*40.-p*20.)*amp;gl_FragColor=mix(A(u),B(u),p);`},
    {id:"swirl", name:"Swirl", cat:"Distort", f:`vec2 q=(v-.5)*vec2(asp,1.);float d=length(q);float an=sin(3.1416*p)*6.*max(0.,1.-d*1.6);q=mat2(cos(an),-sin(an),sin(an),cos(an))*q;vec2 u=q/vec2(asp,1.)+.5;gl_FragColor=mix(A(u),B(u),smoothstep(.3,.7,p));`},
    {id:"wave", name:"Wave", cat:"Distort", f:`float amp=sin(3.1416*p)*.05;vec2 u=v+vec2(sin(v.y*18.+p*10.)*amp,0.);gl_FragColor=mix(A(u),B(u),p);`},
    {id:"glitch", name:"Glitch", cat:"Distort", f:`float st=sin(3.1416*p);float row=floor(v.y*30.);float k=floor(p*20.);float sh=rnd(vec2(row,k))>.6?(rnd(vec2(k,row))-.5)*st*.3:0.;vec2 u=vec2(fract(v.x+sh),v.y);float o=st*.02;vec4 a=p<.5?A(u):B(u);vec4 ar=p<.5?A(u+vec2(o,0.)):B(u+vec2(o,0.));vec4 ab=p<.5?A(u-vec2(o,0.)):B(u-vec2(o,0.));gl_FragColor=vec4(ar.r,a.g,ab.b,a.a);`},
    {id:"morph", name:"Morph", cat:"Distort", f:`vec4 a0=A(v),b0=B(v);vec2 oa=(b0.rg-.5)*p*.12,ob=(a0.rg-.5)*(1.-p)*.12;gl_FragColor=mix(A(v+oa),B(v-ob),p);`},
    {id:"squeeze", name:"Squeeze", cat:"Distort", f:`float q=ease(p);float w=max(1.-q,.001);float x=(v.x-.5)/w+.5;gl_FragColor=(x>=0.&&x<=1.)?mix(A(vec2(x,v.y)),B(v),q*q):B(v);`},
    {id:"kaleido", name:"Kaleidoscope", cat:"Distort", f:`float st=sin(3.1416*p);vec2 q=(v-.5)*vec2(asp,1.);float an=atan(q.y,q.x);float rr=length(q);float sg=6.2832/6.;float a2=abs(mod(an,sg)-sg*.5);vec2 k=vec2(cos(a2),sin(a2))*rr/vec2(asp,1.)+.5;vec2 u=mix(v,k,st);gl_FragColor=mix(A(u),B(u),smoothstep(.35,.65,p));`},
    /* Impact */
    {id:"shake", name:"Shake", cat:"Impact", f:`float st=sin(3.1416*p)*.04;vec2 o=vec2(rnd(vec2(floor(p*30.),1.))-.5,rnd(vec2(floor(p*30.),2.))-.5)*st*2.;vec2 u=v+o;gl_FragColor=mix(A(u),B(u),smoothstep(.4,.6,p));`},
    {id:"punch", name:"Zoom Punch", cat:"Impact", f:`float q=smoothstep(.45,.55,p);float s=p<.5?1.+p*.6:1.+(1.-p)*.5;vec2 u=.5+(v-.5)/s;vec4 c=mix(A(u),B(u),q);float fl=exp(-abs(p-.5)*20.)*.8;gl_FragColor=vec4(mix(c.rgb,vec3(1.),fl),c.a);`}
  ];
  const trById = Object.fromEntries(TR.map(x => [x.id, x]));
  const TRCATS = [...new Set(TR.map(x => x.cat))];
  const THEAD = `precision highp float;varying vec2 v;uniform sampler2D ta,tb;uniform vec2 r;uniform float p,time;
    vec4 A(vec2 u){return texture2D(ta,clamp(u,0.,1.));}vec4 B(vec2 u){return texture2D(tb,clamp(u,0.,1.));}
    vec4 Ac(vec2 u){return (u.x<0.||u.x>1.||u.y<0.||u.y>1.)?vec4(0.):texture2D(ta,u);}vec4 Bc(vec2 u){return (u.x<0.||u.x>1.||u.y<0.||u.y>1.)?vec4(0.):texture2D(tb,u);}
    float rnd(vec2 co){return fract(sin(dot(co,vec2(12.9898,78.233)))*43758.5453);}float ease(float x){return x<.5?2.*x*x:1.-pow(-2.*x+2.,2.)/2.;}`;
  let texA = null, texB = null;
  const trProgs = {};
  function trProg(id) {
    if (trProgs[id] !== undefined) return trProgs[id];
    const def = trById[id]; if (!def) return (trProgs[id] = null);
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error("Transition shader", id, gl.getShaderInfoLog(s)); return null; } return s; };
    /* bodies write OUTC in straight colour; the canvas wants premultiplied, so convert once at the end */
    const body = def.f.replace(/gl_FragColor/g, "OUTC");
    const vs = sh(gl.VERTEX_SHADER, VERT), fs = sh(gl.FRAGMENT_SHADER, THEAD + "void main(){float asp=r.x/r.y;vec4 OUTC=vec4(0.);" + body + "gl_FragColor=vec4(OUTC.rgb*OUTC.a,OUTC.a);}");
    if (!vs || !fs) return (trProgs[id] = null);
    const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.bindAttribLocation(pr, 0, "p"); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.error("Transition link", id, gl.getProgramInfoLog(pr)); return (trProgs[id] = null); }
    const u = {}; ["ta", "tb", "r", "p", "time"].forEach(n => { u[n] = gl.getUniformLocation(pr, n); });
    return (trProgs[id] = {p:pr, u});
  }
  /* Blend canvases a (outgoing) and b (incoming), both w×h with transparent background, at progress p. */
  function transition(a, b, w, h, id, p, time) {
    if (!init()) return null;
    const pr = trProg(id); if (!pr) return null;
    if (!texA) { texA = makeTex(); texB = makeTex(); }
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    try {
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texA); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, a);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texB); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, b);
    } catch (e) { return null; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h); gl.useProgram(pr.p);
    gl.uniform1i(pr.u.ta, 0); gl.uniform1i(pr.u.tb, 1); gl.uniform2f(pr.u.r, w, h); gl.uniform1f(pr.u.p, Math.min(1, Math.max(0, p))); gl.uniform1f(pr.u.time, time || 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
    return cv;
  }
  window.FX = {LIB, CATS, byId, render, defaults, supported:() => init(), TR, TRCATS, trById, transition, setLut, hasLut:id => !!lutTex[id]};
})();
