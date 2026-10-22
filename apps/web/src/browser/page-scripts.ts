import type { BrowserTarget } from "@pego/agent";

/**
 * Code that runs INSIDE the browsed page, as plain JavaScript strings (never `fn.toString()`:
 * the bundler may rename functions or inject helpers like `__name`). Each builder returns an
 * expression for `Runtime.evaluate({ returnByValue: true })`. It evaluates to a JSON string
 * `{ ok } | { error }`; `unwrapEvaluation` turns that (or a CDP exception) into a value or an Error.
 */

/** Marks the element the user picked; `target: "selection"` resolves to it. */
export const PICKED_ATTRIBUTE = "data-pego-picked";
/** Marks the picker's own nodes so snapshots and hit-testing ignore them. */
export const OVERLAY_ATTRIBUTE = "data-pego-overlay";
/** Prefix of the console.debug messages pages send back to the editor. */
export const PAGE_MESSAGE_PREFIX = "__pego__:";
const PICKER_STOP_KEY = "__pegoPickerStop";

/** Wraps a function body so thrown errors come back as data instead of CDP exceptions. */
const wrap = (body: string): string =>
  "(function(){try{" +
  body +
  "}catch(e){return JSON.stringify({error:String(e&&e.message||e)})}})()";

/** Shared prelude: `resolveTarget(t)` -> `{ el, full }` and `pageBox(el, full)`. */
const COMMON = String.raw`
function round(n){return Math.round(n*100)/100}
function resolveTarget(t){
  if(t.kind==="full-page"){
    if(!document.body) throw new Error("The page has no body");
    return {el:document.body,full:true};
  }
  if(t.kind==="selection"){
    var picked=document.querySelector("[data-pego-picked]");
    if(!picked) throw new Error("No element picked: use the picker first");
    return {el:picked,full:false};
  }
  var found=null;
  try{found=document.querySelector(t.selector)}catch(e){throw new Error("Invalid selector "+t.selector)}
  if(!found) throw new Error("No element matches "+t.selector);
  return {el:found,full:false};
}
function pageBox(el,full){
  if(full){
    var d=document.documentElement,b=document.body;
    return {x:0,y:0,
      width:round(Math.max(d.scrollWidth,b.scrollWidth,d.clientWidth)),
      height:round(Math.max(d.scrollHeight,b.scrollHeight,d.clientHeight))};
  }
  var r=el.getBoundingClientRect();
  return {x:round(r.left+window.scrollX),y:round(r.top+window.scrollY),width:round(r.width),height:round(r.height)};
}
`;

/**
 * Color normalization helpers (page side): modern Chrome reports computed colors in their own
 * space (oklch, lab, color(display-p3 ...)); everything we emit must be rgb()/rgba().
 */
export const COLOR_HELPERS = String.raw`
var __cc=null;
function normColor(c){
  if(typeof c!=="string"||!c||/^rgba?\(/.test(c))return c;
  try{
    if(!__cc){var cv=document.createElement("canvas");cv.width=1;cv.height=1;__cc=cv.getContext("2d",{willReadFrequently:true})}
    __cc.clearRect(0,0,1,1);
    __cc.fillStyle="#010203";
    __cc.fillStyle=c;
    if(__cc.fillStyle==="#010203"&&c.replace(/\s/g,"").toLowerCase()!=="#010203")return c;
    __cc.fillRect(0,0,1,1);
    var d=__cc.getImageData(0,0,1,1).data;
    return d[3]===255?"rgb("+d[0]+", "+d[1]+", "+d[2]+")":"rgba("+d[0]+", "+d[1]+", "+d[2]+", "+Math.round(d[3]/255*1000)/1000+")";
  }catch(e){return c}
}
var COLOR_FN=/(?<![\w-])(?:oklch|oklab|lab|lch|color|hwb|hsla?)\((?:[^()]|\([^()]*\))*\)/g;
var GRADIENT_SPACE=/\s*\bin\s+(?:oklab|oklch|srgb-linear|srgb|display-p3|a98-rgb|prophoto-rgb|rec2020|xyz-d50|xyz-d65|xyz|lab|lch|hsl|hwb)(?:\s+(?:shorter|longer|increasing|decreasing)\s+hue)?/g;
function normColors(s){
  if(typeof s!=="string"||!s)return s;
  return s.replace(GRADIENT_SPACE,"").replace(/gradient\(\s*,\s*/g,"gradient(").replace(COLOR_FN,normColor);
}
`;

const targetJson = (target: BrowserTarget): string =>
  JSON.stringify(
    target.kind === "query" ? { kind: "query", selector: target.selector } : { kind: target.kind },
  );

/** The target's page-coordinate box, `{ x, y, width, height }`. */
export const boxScript = (target: BrowserTarget): string =>
  wrap(
    COMMON +
      "var r=resolveTarget(" +
      targetJson(target) +
      ");return JSON.stringify({ok:pageBox(r.el,r.full)});",
  );

const SNAPSHOT_BODY = String.raw`
var MAX_NODES=4000,MAX_INLINE=1400000,MAX_TOTAL_INLINE=8000000,inlined=0,count=0;
function takeBudget(url){
  if(!url||inlined+url.length>MAX_TOTAL_INLINE)return null;
  inlined+=url.length;return url;
}
var SKIP={SCRIPT:1,STYLE:1,NOSCRIPT:1,TEMPLATE:1,HEAD:1,LINK:1,META:1,TITLE:1,BASE:1};
function px(v){var n=parseFloat(v);return isFinite(n)?n:0}
function rectBox(r){return {x:round(r.left+window.scrollX),y:round(r.top+window.scrollY),width:round(r.width),height:round(r.height)}}
function isOwn(el){return el.hasAttribute&&el.hasAttribute("data-pego-overlay")}
function textStyle(cs){
  var s={color:normColor(cs.color),fontFamily:cs.fontFamily,fontSize:px(cs.fontSize)};
  var w=parseInt(cs.fontWeight,10);s.fontWeight=isFinite(w)?w:(cs.fontWeight==="bold"?700:400);
  s.fontStyle=cs.fontStyle==="italic"||cs.fontStyle==="oblique"?"italic":"normal";
  var lh=parseFloat(cs.lineHeight);if(isFinite(lh)&&lh>0)s.lineHeight=lh;
  var ls=parseFloat(cs.letterSpacing);if(isFinite(ls)&&ls!==0)s.letterSpacing=ls;
  if(cs.textAlign&&cs.textAlign!=="start")s.textAlign=cs.textAlign;
  if(cs.textTransform&&cs.textTransform!=="none")s.textTransform=cs.textTransform;
  if(cs.objectFit&&cs.objectFit!=="fill")s.objectFit=cs.objectFit;
  return s;
}
function elementStyle(cs,rect){
  var s={display:cs.display};
  if(cs.position&&cs.position!=="static")s.position=cs.position;
  var flex=cs.display.indexOf("flex")>=0,grid=cs.display.indexOf("grid")>=0;
  if(flex){
    s.flexDirection=cs.flexDirection;
    if(cs.flexWrap!=="nowrap")s.flexWrap=cs.flexWrap;
  }
  if(flex||grid){
    if(cs.justifyContent&&cs.justifyContent!=="normal")s.justifyContent=cs.justifyContent;
    if(cs.alignItems&&cs.alignItems!=="normal")s.alignItems=cs.alignItems;
    var g=px(flex&&cs.flexDirection.indexOf("column")===0?cs.rowGap:cs.columnGap);
    if(g>0)s.gap=g;
  }
  var pad=[px(cs.paddingTop),px(cs.paddingRight),px(cs.paddingBottom),px(cs.paddingLeft)];
  if(pad.some(function(v){return v>0}))s.padding=pad;
  if(cs.backgroundColor&&cs.backgroundColor!=="rgba(0, 0, 0, 0)"&&cs.backgroundColor!=="transparent")s.backgroundColor=normColor(cs.backgroundColor);
  if(cs.backgroundImage&&cs.backgroundImage!=="none")s.backgroundImage=normColors(cs.backgroundImage);
  var sides=["Top","Right","Bottom","Left"],bw=[],bc;
  for(var i=0;i<4;i++){
    var w=cs["border"+sides[i]+"Style"]==="none"||cs["border"+sides[i]+"Style"]==="hidden"?0:px(cs["border"+sides[i]+"Width"]);
    bw.push(w);
    if(w>0&&bc===undefined)bc=normColor(cs["border"+sides[i]+"Color"]);
  }
  if(bc!==undefined){s.borderWidth=bw;s.borderColor=bc}
  var rad=cs.borderTopLeftRadius,rv=px(rad);
  if(rad.indexOf("%")>0)rv=rv/100*Math.min(rect.width,rect.height);
  if(rv>0)s.borderRadius=round(rv);
  var op=parseFloat(cs.opacity);if(isFinite(op)&&op<1)s.opacity=op;
  if(cs.boxShadow&&cs.boxShadow!=="none")s.boxShadow=normColors(cs.boxShadow);
  if(cs.overflowX!=="visible"||cs.overflowY!=="visible")s.overflowHidden=true;
  return s;
}
function componentOf(el){
  var key=null,k;
  for(k in el){if(k.indexOf("__reactFiber$")===0){key=k;break}}
  if(!key)return null;
  var f=el[key],hops=0;
  f=f&&f.return;
  while(f&&hops<40){
    var t=f.type,name=null;
    if(typeof t==="function")name=t.displayName||t.name;
    else if(t&&typeof t==="object"){
      var inner=t.render||t.type;
      name=t.displayName||(inner&&(inner.displayName||inner.name));
    }
    if(name)return {name:name,type:t};
    f=f.return;hops++;
  }
  return null;
}
function inlineImage(img){
  try{
    if(inlined>=MAX_TOTAL_INLINE||!img.complete||!img.naturalWidth)return null;
    var w=img.naturalWidth,h=img.naturalHeight,s=Math.min(1,2048/Math.max(w,h));
    var c=document.createElement("canvas");
    c.width=Math.max(1,Math.round(w*s));c.height=Math.max(1,Math.round(h*s));
    c.getContext("2d").drawImage(img,0,0,c.width,c.height);
    var url=c.toDataURL("image/webp",0.9);
    return url.length<=MAX_INLINE?takeBudget(url):null;
  }catch(e){return null}
}
function imageSource(el){
  var tag=el.tagName;
  if(tag==="IMG"){
    var src=el.currentSrc||el.src;
    if(!src)return null;
    if(src.indexOf("data:")===0)return takeBudget(src);
    return inlineImage(el)||(src.indexOf("https:")===0?src:null);
  }
  if(tag==="VIDEO"){
    var poster=el.poster;
    if(!poster)return null;
    if(poster.indexOf("https:")===0)return poster;
    return poster.indexOf("data:")===0?takeBudget(poster):null;
  }
  return null;
}
function svgMarkup(svg){
  var clone=svg.cloneNode(true);
  var a=[svg].concat(Array.prototype.slice.call(svg.querySelectorAll("*")));
  var b=[clone].concat(Array.prototype.slice.call(clone.querySelectorAll("*")));
  for(var i=0;i<a.length&&i<b.length;i++){
    var cs=getComputedStyle(a[i]);
    if(cs.fill)b[i].setAttribute("fill",normColor(cs.fill));
    if(cs.stroke&&cs.stroke!=="none"){
      b[i].setAttribute("stroke",normColor(cs.stroke));
      b[i].setAttribute("stroke-width",cs.strokeWidth);
    }
  }
  if(!clone.getAttribute("xmlns"))clone.setAttribute("xmlns","http://www.w3.org/2000/svg");
  var r=svg.getBoundingClientRect();
  if(!clone.getAttribute("width"))clone.setAttribute("width",String(round(r.width)));
  if(!clone.getAttribute("height"))clone.setAttribute("height",String(round(r.height)));
  return clone.outerHTML;
}
function visible(cs){
  return cs.display!=="none"&&cs.visibility!=="hidden"&&cs.visibility!=="collapse"&&parseFloat(cs.opacity)!==0;
}
function addText(node,parent,pcs,out){
  var raw=node.nodeValue||"";
  if(!/\S/.test(raw)||count>=MAX_NODES)return;
  var range=document.createRange();range.selectNodeContents(node);
  var rects=range.getClientRects(),l=Infinity,t=Infinity,r=-Infinity,b=-Infinity;
  for(var i=0;i<rects.length;i++){
    var q=rects[i];if(q.width===0&&q.height===0)continue;
    l=Math.min(l,q.left);t=Math.min(t,q.top);r=Math.max(r,q.right);b=Math.max(b,q.bottom);
  }
  if(!isFinite(l))return;
  var pre=pcs.whiteSpace.indexOf("pre")===0;
  // Inline text wrapping over several lines (often starting mid-line after a sibling) would
  // overlap as one fixed-width box: split it into one text per line box instead.
  if(!pre&&rects.length>1&&raw.length<=4000){
    var lines=splitLines(node,raw);
    if(lines.length>1){
      for(var k=0;k<lines.length&&count<MAX_NODES;k++){
        var line=lines[k],lt=line.text.replace(/\s+/g," ").trim();
        if(!lt)continue;
        count++;
        out.push({kind:"text",text:lt,box:rectBox({left:line.l,top:line.t,width:line.r-line.l,height:line.b-line.t}),style:textStyle(pcs)});
      }
      return;
    }
  }
  var text=pre?raw:raw.replace(/\s+/g," ").trim();
  count++;
  out.push({kind:"text",text:text,box:rectBox({left:l,top:t,width:r-l,height:b-t}),style:textStyle(pcs)});
}
function splitLines(node,raw){
  var range=document.createRange(),lines=[],cur=null;
  for(var i=0;i<raw.length;i++){
    range.setStart(node,i);range.setEnd(node,i+1);
    var q=range.getBoundingClientRect();
    if(q.width===0&&q.height===0){if(cur)cur.text+=raw[i];continue;}
    if(!cur||q.top>=cur.b-1){
      cur={text:"",l:q.left,t:q.top,r:q.right,b:q.bottom};lines.push(cur);
    }
    cur.text+=raw[i];
    cur.l=Math.min(cur.l,q.left);cur.r=Math.max(cur.r,q.right);
    cur.t=Math.min(cur.t,q.top);cur.b=Math.max(cur.b,q.bottom);
  }
  return lines;
}
function walkChildren(el,out,pcomp,pcs){
  for(var n=el.firstChild;n&&count<MAX_NODES;n=n.nextSibling){
    if(n.nodeType===1)walk(n,out,pcomp,false);
    else if(n.nodeType===3)addText(n,el,pcs,out);
  }
}
function walk(el,out,pcomp,isRoot){
  if(count>=MAX_NODES||SKIP[el.tagName]||isOwn(el))return;
  var cs=getComputedStyle(el);
  if(cs.display==="none")return;
  if(cs.display==="contents"){walkChildren(el,out,pcomp,cs);return}
  if(!visible(cs))return;
  var rect=el.getBoundingClientRect();
  if(!isRoot&&(rect.width===0||rect.height===0))return;
  var tag=el.tagName.toLowerCase(),box=rectBox(rect),style=elementStyle(cs,rect);
  if(tag==="svg"){
    count++;
    out.push({kind:"svg",markup:svgMarkup(el),box:box,style:style});
    return;
  }
  if(tag==="img"||tag==="video"){
    var src=imageSource(el);
    if(src){
      count++;
      var img={kind:"image",tag:tag,src:src,box:box,style:style};
      if(el.alt)img.alt=el.alt;
      out.push(img);
    }
    return;
  }
  if(tag==="canvas"){
    var data=null;
    if(inlined<MAX_TOTAL_INLINE){try{data=el.toDataURL("image/png")}catch(e){}}
    if(data&&data.length<=MAX_INLINE&&takeBudget(data)){
      count++;
      out.push({kind:"image",tag:tag,src:data,box:box,style:style});
      return;
    }
  }
  count++;
  var node={kind:"element",tag:tag,box:box,style:style,children:[]};
  var comp=componentOf(el);
  if(comp&&(!pcomp||pcomp.type!==comp.type))node.component=comp.name;
  out.push(node);
  if(tag==="input"||tag==="textarea"){
    var val=el.value||"";
    if(/\S/.test(val)&&el.type!=="password"){
      var pl=px(cs.paddingLeft)+px(cs.borderLeftWidth),pt=px(cs.paddingTop)+px(cs.borderTopWidth);
      node.children.push({kind:"text",text:val,
        box:{x:round(box.x+pl),y:round(box.y+pt),width:round(Math.max(0,box.width-pl-px(cs.paddingRight)-px(cs.borderRightWidth))),height:round(Math.max(0,box.height-pt-px(cs.paddingBottom)-px(cs.borderBottomWidth)))},
        style:textStyle(cs)});
      count++;
    }
    return;
  }
  walkChildren(el,node.children,comp||pcomp,cs);
}
var r=resolveTarget(TARGET),out=[];
walk(r.el,out,null,true);
if(out.length===0)throw new Error("The target is not visible");
var root=out[0];
if(r.full){
  root.box=pageBox(r.el,true);
  if(root.kind==="element"&&!root.style.backgroundColor){
    var rootBg=getComputedStyle(document.documentElement).backgroundColor;
    if(rootBg&&rootBg!=="rgba(0, 0, 0, 0)")root.style.backgroundColor=normColor(rootBg);
  }
}else if(root.kind==="element"&&!root.style.backgroundColor){
  // A picked element usually shows its ancestors' background: carry the nearest opaque one.
  for(var anc=r.el.parentElement;anc;anc=anc.parentElement){
    var ancBg=getComputedStyle(anc).backgroundColor;
    if(ancBg&&ancBg!=="rgba(0, 0, 0, 0)"&&ancBg!=="transparent"){root.style.backgroundColor=normColor(ancBg);break;}
  }
  // No declared background anywhere up the tree: the page shows the browser's white canvas.
  if(!root.style.backgroundColor)root.style.backgroundColor="rgb(255, 255, 255)";
}
return JSON.stringify({ok:{url:location.href,title:document.title,root:root}});
`;

/** Walks the target into a `DomSnapshot` (url, title, root), at most ~4000 nodes. */
export const snapshotScript = (target: BrowserTarget): string =>
  wrap(COMMON + COLOR_HELPERS + "var TARGET=" + targetJson(target) + ";" + SNAPSHOT_BODY);

const DESCRIBE_BODY = String.raw`
var MAX_HTML=20000,MAX_DESCENDANTS=50;
var SKIP_PROPS=/^(width|height|block-size|inline-size|perspective-origin|transform-origin)$/;
var INHERITED=/^(color|font|line-height|letter-spacing|word-spacing|text-align|text-indent|text-transform|text-shadow|white-space|cursor|visibility|direction|list-style|quotes|tab-size|caret-color|word-break|overflow-wrap|-webkit-text-fill|-webkit-text-stroke|-webkit-font|-webkit-locale)/;
var frame=null,defaults={};
function defaultStyle(el){
  var key=el.namespaceURI+" "+el.tagName;
  if(defaults[key])return defaults[key];
  var doc=frame.contentDocument,probe=doc.createElementNS(el.namespaceURI,el.tagName.toLowerCase());
  doc.body.appendChild(probe);
  var cs=doc.defaultView.getComputedStyle(probe),map={};
  for(var i=0;i<cs.length;i++)map[cs[i]]=cs.getPropertyValue(cs[i]);
  doc.body.removeChild(probe);
  defaults[key]=map;
  return map;
}
function label(el){
  var s=el.tagName.toLowerCase();
  if(el.id)s+="#"+el.id;
  var cls=typeof el.className==="string"?el.className.trim().split(/\s+/).filter(Boolean).slice(0,3):[];
  return s+(cls.length?"."+cls.join("."):"");
}
function diff(el,parent){
  var cs=getComputedStyle(el),def=defaultStyle(el),pcs=parent?getComputedStyle(parent):null,lines=[];
  for(var i=0;i<cs.length;i++){
    var p=cs[i],v=cs.getPropertyValue(p);
    if(SKIP_PROPS.test(p)||def[p]===v)continue;
    if(pcs&&INHERITED.test(p)&&pcs.getPropertyValue(p)===v)continue;
    lines.push("  "+p+": "+v);
  }
  return lines;
}
var r=resolveTarget(TARGET),el=r.el;
var html=el.outerHTML.replace(/ data-pego-picked=""/g,"");
if(html.length>MAX_HTML)html=html.slice(0,MAX_HTML)+"\n... (truncated, "+html.length+" characters in all)";
var b=pageBox(el,r.full);
// Only after the target resolved: a bad selector must not leave an iframe behind.
frame=document.createElement("iframe");
frame.setAttribute("data-pego-overlay","");
frame.style.cssText="position:absolute;visibility:hidden;width:0;height:0;border:0;pointer-events:none";
document.documentElement.appendChild(frame);
try{

var out=["URL: "+location.href,"Box: x="+b.x+" y="+b.y+" width="+b.width+" height="+b.height,"","HTML:",html,"","Computed styles that differ from a default element of the same tag (inherited values equal to the parent's are left out):"];
var list=[el].concat(Array.prototype.slice.call(el.querySelectorAll("*"),0,MAX_DESCENDANTS));
for(var i=0;i<list.length;i++){
  var lines=diff(list[i],i===0?null:list[i].parentElement);
  out.push("",label(list[i])+(lines.length?"":" (defaults)"));
  for(var j=0;j<lines.length;j++)out.push(lines[j]);
}
}finally{frame.remove()}
return JSON.stringify({ok:out.join("\n")});
`;

/** The target's outerHTML plus its non-default computed styles, as readable text. */
export const describeScript = (target: BrowserTarget): string =>
  wrap(COMMON + "var TARGET=" + targetJson(target) + ";" + DESCRIBE_BODY);

const PICKER_BODY = String.raw`
var KEY="__pegoPickerStop";
if(typeof window[KEY]==="function")window[KEY]();
var root=document.documentElement,prevCursor=root.style.cursor;
var hl=document.createElement("div");
hl.setAttribute("data-pego-overlay","");
hl.style.cssText="position:fixed;left:0;top:0;width:0;height:0;display:none;box-sizing:border-box;pointer-events:none;z-index:2147483647;border:2px solid #4f46e5;background:rgba(79,70,229,0.12)";
var chip=document.createElement("div");
chip.style.cssText="position:absolute;left:-2px;top:-22px;padding:2px 6px;font:11px/16px ui-monospace,Menlo,monospace;color:#fff;background:#4f46e5;white-space:nowrap;border-radius:3px";
hl.appendChild(chip);
root.appendChild(hl);
root.style.cursor="crosshair";
var current=null;
function send(m){console.debug("__pego__:"+JSON.stringify(m))}
function own(n){return n===hl||hl.contains(n)}
function place(el){
  var r=el.getBoundingClientRect();
  hl.style.display="block";
  hl.style.left=r.left+"px";hl.style.top=r.top+"px";
  hl.style.width=r.width+"px";hl.style.height=r.height+"px";
  chip.textContent=el.tagName.toLowerCase()+" "+Math.round(r.width)+" x "+Math.round(r.height);
  chip.style.top=r.top<24?"auto":"-22px";
  chip.style.bottom=r.top<24?"-22px":"auto";
}
function hit(e){var t=e.target;return t&&t.nodeType===1&&!own(t)?t:null}
function onMove(e){var t=hit(e);if(!t)return;current=t;place(t)}
function onClick(e){
  var t=hit(e);
  if(!t)return;
  e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();
  var prev=document.querySelector("[data-pego-picked]");
  if(prev&&prev!==t)prev.removeAttribute("data-pego-picked");
  t.setAttribute("data-pego-picked","");
  var text=(t.textContent||"").replace(/\s+/g," ").trim().slice(0,40);
  stop();
  send({type:"picked",tag:t.tagName.toLowerCase(),text:text});
}
function swallow(e){if(hit(e)){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation()}}
function onKey(e){
  if(e.key!=="Escape")return;
  e.preventDefault();e.stopPropagation();
  stop();
  send({type:"pick-cancelled"});
}
function onViewport(){if(current)place(current)}
var swallowed=["mousedown","mouseup","pointerdown","pointerup","auxclick","dblclick","contextmenu"];
function stop(){
  window.removeEventListener("mousemove",onMove,true);
  window.removeEventListener("click",onClick,true);
  window.removeEventListener("keydown",onKey,true);
  window.removeEventListener("scroll",onViewport,true);
  window.removeEventListener("resize",onViewport,true);
  swallowed.forEach(function(n){window.removeEventListener(n,swallow,true)});
  root.style.cursor=prevCursor;
  hl.remove();
  delete window[KEY];
}
window.addEventListener("mousemove",onMove,true);
window.addEventListener("click",onClick,true);
window.addEventListener("keydown",onKey,true);
window.addEventListener("scroll",onViewport,true);
window.addEventListener("resize",onViewport,true);
swallowed.forEach(function(n){window.addEventListener(n,swallow,true)});
window[KEY]=stop;
return JSON.stringify({ok:true});
`;

/** Arms the element picker in the page (hover highlights, click picks, Escape cancels). */
export const pickerStartScript: string = wrap(PICKER_BODY);

/** Removes the picker (a no-op when it is not armed). */
export const pickerStopScript: string = wrap(
  "var f=window[" +
    JSON.stringify(PICKER_STOP_KEY) +
    '];if(typeof f==="function")f();return JSON.stringify({ok:true});',
);

type EvaluateResult = {
  result?: { value?: unknown; description?: string };
  exceptionDetails?: { text?: string; exception?: { description?: string; value?: unknown } };
};

const firstLine = (text: string): string =>
  (text.split("\n")[0] ?? text).replace(/^\w*Error: /, "");

/**
 * Turns a `Runtime.evaluate` response of one of the scripts above into its value. Rejects with
 * the page's own message for a script error or a CDP exception.
 */
export const unwrapEvaluation = (response: unknown): unknown => {
  const { result, exceptionDetails } = (response ?? {}) as EvaluateResult;
  if (exceptionDetails) {
    const ex = exceptionDetails.exception;
    const message =
      (typeof ex?.value === "string" && ex.value) ||
      (ex?.description ? firstLine(ex.description) : "") ||
      exceptionDetails.text ||
      "The page script failed";
    throw new Error(message);
  }
  const value = result?.value;
  if (typeof value !== "string") throw new Error("The page returned no result");
  const parsed = JSON.parse(value) as { ok?: unknown; error?: string };
  if (parsed.error !== undefined) throw new Error(parsed.error);
  return parsed.ok;
};
