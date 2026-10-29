import { useEffect, useRef } from "react";

// Original chef artwork and motion. Interaction reference (no copied assets):
// https://github.com/Coiggahou2002/grokbot-web — gaze, spring easing and blinks.
export default function ChefMascot() {
  const root = useRef<SVGSVGElement>(null);
  const head = useRef<SVGGElement>(null);
  const face = useRef<SVGGElement>(null);
  const eyes = useRef<SVGGElement>(null);
  const leftEye = useRef<SVGPathElement>(null);
  const rightEye = useRef<SVGPathElement>(null);
  const mouth = useRef<SVGPathElement>(null);
  const cheeks = useRef<SVGGElement>(null);

  useEffect(() => {
    const svg = root.current!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let previous = 0;
    let nextBlink = performance.now() + 2800;
    let blinkStart = -Infinity;
    let pointer: { x: number; y: number } | null = null;
    const target = { x: 0, y: 0, joy: 0, curious: 0 };
    const current = { ...target };
    const velocity = { ...target };

    function locate() {
      const bounds = svg.getBoundingClientRect();
      if (!pointer || !bounds.width || !bounds.height) {
        Object.assign(target, { x: 0, y: 0, joy: 0, curious: 0 });
        return;
      }
      const dx = (pointer.x - bounds.left - bounds.width / 2) / bounds.width;
      const dy =
        (pointer.y - bounds.top - bounds.height * 0.54) / bounds.height;
      target.x = Math.tanh(dx * 0.85);
      target.y = Math.tanh(dy * 0.85);
      target.joy = Math.max(0, 1 - Math.hypot(dx, dy) / 0.85);
      target.curious = Math.max(0, -target.y) * (1 - target.joy);
    }

    function paint(now: number) {
      frame = 0;
      if (document.hidden || reduced.matches) return;
      locate();
      const dt = Math.min((now - (previous || now - 16)) / 1000, 0.032);
      previous = now;
      // Damped spring; bounded delta prevents jumps after a suspended window.
      for (const key of ["x", "y", "joy", "curious"] as const) {
        velocity[key] +=
          ((target[key] - current[key]) * 150 - velocity[key] * 23) * dt;
        current[key] += velocity[key] * dt;
      }
      const { x, y, joy, curious } = current;
      head.current!.setAttribute(
        "transform",
        `translate(${x * 3} ${y * 2}) rotate(${x * 5} 100 82)`,
      );
      face.current!.setAttribute("transform", `translate(${x * 7} ${y * 4})`);
      if (now >= nextBlink) {
        blinkStart = now;
        nextBlink = now + 3300 + Math.random() * 2200;
      }
      const progress = (now - blinkStart) / 210;
      const open = progress < 1 ? 1 - Math.sin(progress * Math.PI) * 0.94 : 1;
      eyes.current!.setAttribute(
        "transform",
        `translate(0 82) scale(1 ${open}) translate(0 -82)`,
      );
      const smile = Math.min(1, Math.max(0, joy * 1.8));
      for (const [element, cx] of [
        [leftEye.current!, 85],
        [rightEye.current!, 115],
      ] as const) {
        element.setAttribute(
          "d",
          `M ${cx - smile * 3} ${81 + smile * 2} Q ${cx} ${86 - smile * 10 - curious * 2} ${cx + smile * 3} ${81 + smile * 2}`,
        );
      }
      mouth.current!.setAttribute("d", `M 96 91 Q 100 ${98 + joy * 4} 104 91`);
      cheeks.current!.setAttribute("opacity", String(0.15 + joy * 0.65));
      frame = requestAnimationFrame(paint);
    }
    function start() {
      cancelAnimationFrame(frame);
      previous = 0;
      if (reduced.matches) {
        head.current!.removeAttribute("transform");
        face.current!.removeAttribute("transform");
        eyes.current!.removeAttribute("transform");
        leftEye.current!.setAttribute("d", "M 85 81 Q 85 86 85 81");
        rightEye.current!.setAttribute("d", "M 115 81 Q 115 86 115 81");
        mouth.current!.setAttribute("d", "M 96 91 Q 100 98 104 91");
        cheeks.current!.setAttribute("opacity", "0.15");
      } else if (!document.hidden) {
        nextBlink = performance.now() + 2800;
        frame = requestAnimationFrame(paint);
      }
    }
    function move(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      pointer = { x: event.clientX, y: event.clientY };
    }
    function reset() {
      pointer = null;
    }
    function leave(event: PointerEvent) {
      if (!event.relatedTarget) reset();
    }
    function visibility() {
      reset();
      start();
    }
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerout", leave);
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", visibility);
    reduced.addEventListener("change", start);
    start();
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerout", leave);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", start);
    };
  }, []);

  return (
    <div className="chef-scene">
      <svg
        ref={root}
        viewBox="0 0 200 150"
        role="img"
        aria-label="小厨，陪你开启故事的厨师帽吉祥物"
      >
        <ellipse
          cx="100"
          cy="134"
          rx="44"
          ry="5"
          fill="#e9dcc3"
          opacity="0.65"
        />
        <path
          d="M 27 46 Q 29 56 37 58 Q 29 60 27 70 Q 25 60 17 58 Q 25 56 27 46"
          fill="#d6b46f"
        />
        <path
          d="m 170 99 3 6 6 3-6 3-3 6-3-6-6-3 6-3Z"
          fill="none"
          stroke="#d6b46f"
          strokeWidth="1.3"
        />
        <g ref={head}>
          <path
            d="M 67 87 C 43 79 45 47 70 46 C 81 19 112 19 124 46 C 151 44 158 77 134 88 L 134 117 Q 134 122 129 122 L 72 122 Q 67 122 67 117 Z"
            fill="#fff0d6"
            stroke="#cc8b50"
            strokeWidth="5"
            strokeLinejoin="round"
          />
          <path d="M 69 105 H 132" stroke="#cc8b50" strokeWidth="4" />
          <g ref={face}>
            <g ref={cheeks} fill="#eaa487" opacity="0.15">
              <ellipse cx="76" cy="92" rx="6" ry="3" />
              <ellipse cx="124" cy="92" rx="6" ry="3" />
            </g>
            <g
              ref={eyes}
              fill="none"
              stroke="#916b49"
              strokeWidth="4.5"
              strokeLinecap="round"
            >
              <path ref={leftEye} d="M 85 81 Q 85 86 85 81" />
              <path ref={rightEye} d="M 115 81 Q 115 86 115 81" />
            </g>
            <path
              ref={mouth}
              d="M 96 91 Q 100 98 104 91"
              fill="none"
              stroke="#916b49"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </g>
        </g>
      </svg>
    </div>
  );
}
