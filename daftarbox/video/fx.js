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
  function render(src, srcW, srcH, sx, sy, sw, sh, w, h, list, time, unit) {
    const active = (list || []).filter(e => e && e.on !== false && byId[e.id]);
    if (!active.length || !init()) return null;
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
    draw(prog("_out", OUT), fbos[cur].tex, null, w, h, {});
    return cv;
  }
  function defaults(id) {
    const d = byId[id]; if (!d) return null;
    const e = {id, on:true}; d.params.forEach(p => { e[p.k] = p.def; }); (d.cols || []).forEach(cdef => { e[cdef.k] = cdef.def; });
    return e;
  }
  window.FX = {LIB, CATS, byId, render, defaults, supported:() => init()};
})();
