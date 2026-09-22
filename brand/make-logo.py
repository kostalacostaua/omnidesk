from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
import os
B='./'  # рядом: package/files/manrope-latin-800-normal.woff из @fontsource/manrope
font=TTFont(B+'package/files/manrope-latin-800-normal.woff')
gs=font.getGlyphSet(); cmap=font.getBestCmap(); upm=font['head'].unitsPerEm
def text_path(s, size, x0, baseline, track=-0.02):
    sc=size/upm; x=x0; d=''
    for ch in s:
        g=cmap[ord(ch)]
        pen=SVGPathPen(gs)
        tp=TransformPen(pen,(sc,0,0,-sc,x,baseline))
        gs[g].draw(tp); d+=pen.getCommands()
        x+=gs[g].width*sc + track*size
    return d, x-x0-track*size

# Mark geometry in 100x100
OUTER=("M6 22A16 16 0 0 1 22 6H60A32 32 0 0 1 92 38A28 28 0 0 1 72 64.6"
       "L93 90.5A5 5 0 0 1 89 94H67.5A5 5 0 0 1 63.6 92.1L44 67L25.2 91.2A8 8 0 0 1 6 86Z")
BUBBLE=("M32 23H62A9 9 0 0 1 71 32V41A9 9 0 0 1 62 50H43L30.5 60.5A1.5 1.5 0 0 1 28 59.4V50.2A9 9 0 0 1 23 42V32A9 9 0 0 1 32 23Z")
C1='#2F6BFF'; C2='#7A3CF0'; INK='#0B1022'; NAVY='#0E1530'
def grad(id): return f'<linearGradient id="{id}" x1="10" y1="8" x2="92" y2="94" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="{C1}"/><stop offset="1" stop-color="{C2}"/></linearGradient>'
def mark(fill, id='g', tx=0, ty=0, s=1):
    return f'<path transform="translate({tx} {ty}) scale({s})" fill-rule="evenodd" fill="{fill}" d="{OUTER}{BUBBLE}"/>'
def w(name, svg):
    open(B+'out/'+name,'w').write(svg)
# 1 mark gradient
w('rozmovio-mark.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>{grad("g")}</defs>{mark("url(#g)")}</svg>')
w('rozmovio-mark-white.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">{mark("#FFFFFF")}</svg>')
w('rozmovio-mark-ink.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">{mark(INK)}</svg>')
# app icon: navy squircle 512
w('rozmovio-app-icon.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{C1}"/><stop offset="1" stop-color="{C2}"/></linearGradient></defs><rect width="512" height="512" rx="116" fill="{NAVY}"/><g transform="translate(116 116) scale(2.8)"><path fill-rule="evenodd" fill="url(#g)" d="{OUTER}{BUBBLE}"/></g></svg>')
# horizontal lockup: mark 100 tall; text cap height ~ aligned
def lockup(textfill, markfill, defs, name):
    size=84; d,wd=text_path('Rozmovio', size, 126, 93)
    W=int(128+wd+6)
    w(name, f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} 100"><defs>{defs}</defs>{mark(markfill)}<path fill="{textfill}" d="{d}"/></svg>')
    return W
lockup(INK,'url(#g)',grad('g'),'rozmovio-logo.svg')
lockup('#FFFFFF','url(#g)',grad('g'),'rozmovio-logo-on-dark.svg')
lockup(INK,INK,'','rozmovio-logo-mono.svg')
lockup('#FFFFFF','#FFFFFF','','rozmovio-logo-white.svg')
# wordmark only
d,wd=text_path('Rozmovio',78,0,80)
w('rozmovio-wordmark.svg', f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {int(wd)+2} 100"><path fill="{INK}" d="{d}"/></svg>')
print('ok')
