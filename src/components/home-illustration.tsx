export default function HomeIllustration() {
  return <div className="home-illustration" aria-label="Illustrated home with simple repair details" role="img">
    <div className="illustration-orbit"/>
    <svg viewBox="0 0 620 530" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="wall" x1="220" y1="130" x2="480" y2="430" gradientUnits="userSpaceOnUse"><stop stopColor="#f8f1df"/><stop offset="1" stopColor="#e6ddc8"/></linearGradient>
        <linearGradient id="roof" x1="172" y1="100" x2="495" y2="245" gradientUnits="userSpaceOnUse"><stop stopColor="#476b59"/><stop offset="1" stopColor="#1e4635"/></linearGradient>
        <linearGradient id="door" x1="290" y1="285" x2="364" y2="418" gradientUnits="userSpaceOnUse"><stop stopColor="#dda46d"/><stop offset="1" stopColor="#bf8050"/></linearGradient>
        <filter id="shadow"><feGaussianBlur stdDeviation="13"/></filter>
      </defs>
      <ellipse cx="314" cy="448" rx="210" ry="24" fill="#44634e" opacity=".12" filter="url(#shadow)"/>
      <path d="M96 398 330 313 531 404 305 483Z" fill="#b4c3a0"/><path d="m96 398 209 77 226-71v13l-226 78-209-79Z" fill="#95ac84"/>
      <path d="M171 222 316 272v174l-145-53Z" fill="#d5cbb5"/><path d="m316 272 169-67v181l-169 60Z" fill="url(#wall)"/>
      <path d="m171 222 153-125 161 108-169 67Z" fill="#f5ebd8"/>
      <path d="m142 225 174-151 205 118-32 25L321 116 178 246Z" fill="url(#roof)"/>
      <path d="m142 225 36 21 143-130v-23L165 229Z" fill="#64816c"/><path d="m321 116 168 101v-14L321 99Z" fill="#183c2c"/>
      <path d="m221 96 23-9 33 18-23 9Z" fill="#d8b488"/><path d="m221 96 33 18v63l-33-21Z" fill="#b88966"/><path d="m254 114 23-9v52l-23 20Z" fill="#e0bc91"/>
      <path d="m347 298 65-24v137l-65 23Z" fill="#345443"/><path d="m353 303 53-19v122l-53 19Z" fill="url(#door)"/>
      <path d="m363 315 32-11v40l-32 11Z" stroke="#9f653d" strokeWidth="2"/><path d="m363 368 32-11v35l-32 11Z" stroke="#9f653d" strokeWidth="2"/>
      <circle cx="394" cy="360" r="4" fill="#f1d072"/><path d="m347 434 66-23 16 9-68 24Z" fill="#dfd6c1"/>
      <path d="m432 264 33-12v57l-33 12Z" fill="#345443"/><path d="m436 268 25-9v46l-25 9Z" fill="#b8d1c2"/><path d="m449 263v46m-13-20 25-9" stroke="#faf7eb" strokeWidth="3"/>
      <path d="m205 266 71 25v78l-71-26Z" fill="#587161"/><path d="m211 274 59 21v64l-59-22Z" fill="#c7d9cb"/><path d="m241 286v63m-30-43 59 22" stroke="#f5f0df" strokeWidth="5"/>
      <path d="m202 341 76 28v8l-76-27Z" fill="#a78660"/>
      <path d="m242 376 43 16-3 27-38-14Z" fill="#aa714d"/><path d="M251 383c-22-24-7-34 4-19-5-29 15-33 14-9 20-20 29-3 8 19 22-3 18 17-5 18Z" fill="#5b7b49"/>
      <path d="m140 391 10-55" stroke="#715a3c" strokeWidth="6"/><path d="M149 359c-58-2-31-58-8-43-32-46 31-62 30-22 39-10 40 44 5 44 16 22-6 39-27 21Z" fill="#779064"/>
      <path d="m467 393 7-41" stroke="#715a3c" strokeWidth="5"/><path d="M474 366c-34-2-29-35-5-37-15-26 25-40 28-8 26 7 12 42-23 45Z" fill="#6c885a"/>
      <path d="m307 450 20 8 20-7-20-8Zm32 12 20 8 20-7-20-8Zm-57-1 20 8 20-7-20-8Z" fill="#e6ddc6"/>
      <path d="m391 156 9-25 12 5-9 25Z" fill="#e5e0cb"/><path d="m402 132 7-18 7 3-7 18Z" fill="#a7b5a1"/>
      <path d="M94 170h28m-14-14v28M506 313h18m-9-9v18" stroke="#c9aa58" strokeWidth="3" strokeLinecap="round"/>
      <circle cx="482" cy="101" r="5" fill="#d2b06a"/><circle cx="123" cy="287" r="4" fill="#abc09a"/>
    </svg>
    <div className="visual-label label-top"><span className="label-icon">✦</span><div>A little guidance.<small>A lot more confidence.</small></div></div>
    <div className="visual-label label-bottom"><span className="status-dot"/><div>Your next small fix starts here.</div></div>
    <span className="visual-caption">A happier home, one fix at a time.</span>
  </div>;
}
