"use client";

import { useEffect } from "react";
import "./telos-site.css";

/**
 * TELOS marketing homepage — a faithful port of the Claude Design "telos-website"
 * bundle. Seven "breaths" (Hero · Problem · Brain · Impact · Three Gates · Where
 * We Start · Invitation), the Light Layer (one breathing hero per screen), quiet
 * type. Styling in ./telos-site.css; tokens from the global design system.
 *
 * CGI windows #1–#5 are placeholders (hero uses founding-basil.png); swap with
 * real renders when they arrive. Standalone chrome — the dashboard Nav hides on
 * this route (see components/Nav.tsx).
 */
export default function SitePage() {
  useEffect(() => {
    const nav = document.getElementById("site-nav");
    const onScroll = () => {
      if (!nav) return;
      if (window.scrollY > 40) nav.classList.add("scrolled");
      else nav.classList.remove("scrolled");
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const reveals = Array.from(document.querySelectorAll(".telos-site .reveal"));
    let io: IntersectionObserver | null = null;
    if (reduce || !("IntersectionObserver" in window)) {
      reveals.forEach((el) => el.classList.add("in"));
    } else {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add("in");
              io?.unobserve(e.target);
            }
          });
        },
        { threshold: 0.16, rootMargin: "0px 0px -8% 0px" }
      );
      reveals.forEach((el) => io!.observe(el));
      // hero reveals immediately
      document
        .querySelectorAll("#site-hero .reveal")
        .forEach((el) => requestAnimationFrame(() => el.classList.add("in")));
    }
    return () => {
      window.removeEventListener("scroll", onScroll);
      io?.disconnect();
    };
  }, []);

  return (
    <div className="telos-site" id="top">
      <nav className="nav" id="site-nav">
        <a className="wordmark" href="#top">TELOS</a>
        <a className="nav-cta" href="#invitation">Begin <span aria-hidden="true">→</span></a>
      </nav>

      <main>
        {/* 1 · HERO */}
        <section className="section section-hero lit breathing" id="site-hero">
          {/* eslint-disable-next-line @next/next/no-img-element -- full-bleed cinematic hero; object-fit cover, not a content image */}
          <img className="hero-img" src="/brand/founding-basil.png" alt="A single basil plant, lit by one beam of light in the dark." />
          <div className="glow hero-glow" />
          <div className="vignette hero-vignette" />
          <div className="dust" />
          <span className="cgi-tag hero-cgi"><i className="ph-light ph-plant" />CGI #1 · the lit plant</span>
          <div className="hero-content reveal">
            <h1 className="display h-hero">Every plant,<br />its fullest self.</h1>
            <p className="subline hero-sub">Every plant has a best version of itself. We help it get there — <em>every time</em>.</p>
            <a className="cta" href="#brain">See how <span className="arrow" aria-hidden="true">→</span></a>
          </div>
          <div className="scroll-hint reveal d2" aria-hidden="true"><span className="scroll-line" /></div>
        </section>

        {/* 2 · THE PROBLEM */}
        <section className="section" id="problem">
          <div className="section-inner warm-pool">
            <div className="measure">
              <h2 className="display h-section reveal">The plant is always<br />telling you something.</h2>
              <p className="subline problem-sub reveal d1">The best growers spend years learning to read it — and even then, no one can watch every plant, every hour, and catch every signal in time.</p>
              <p className="coda problem-coda reveal d2">So much of a plant&apos;s potential is lost in what slips past us.</p>
            </div>
          </div>
        </section>

        {/* 3 · THE BRAIN */}
        <section className="section" id="brain">
          <div className="section-inner brain-grid">
            <div className="brain-copy">
              <h2 className="display h-section reveal">A brain that never<br />stops listening.</h2>
              <p className="subline brain-sub reveal d1">TELOS combines your craft with deep knowledge of each specific cultivar — then listens to the plant continuously through its sensors, at a precision no human can sustain.</p>
              <p className="subline brain-sub soft reveal d2">It catches what the eye misses, and gives the plant exactly what it needs to reach its fullest expression.</p>
            </div>
            <div className="brain-window cgi lit breathing standard reveal d2">
              <div className="glow" />
              <div className="beam" />
              <div className="vignette" />
              <div className="dust" />
              <div className="cgi-cue empty-cue">
                <i className="ph-light ph-pulse" />
                <div className="n">CGI #2 · the Brain in context</div>
                <div className="d">placeholder — swap with render</div>
              </div>
              <span className="annotation brain-annotation"><span className="dot" />Listening</span>
            </div>
          </div>
        </section>

        {/* 4 · THE IMPACT */}
        <section className="section section-impact" id="impact">
          <div className="section-inner measure-wide">
            <h2 className="display h-section reveal">A better crop,<br />every single time.</h2>
            <p className="subline impact-sub reveal d1">Not a bigger yield — a <em>better</em> one. A tomato that tastes like it&apos;s supposed to. Basil with the oils still loud. The kind of quality buyers notice, taste, and come back for — consistently, not on a good week.</p>
            <p className="coda impact-coda reveal d2">Quality this rare is quality people pay more for.</p>
          </div>
        </section>

        {/* 5 · THREE GATES */}
        <section className="section section-gates" id="three-gates">
          <div className="section-inner">
            <h2 className="display h-section gates-head reveal">Wherever something grows.</h2>
            <div className="gates">
              <a className="gate gate-farm cgi lit breathing reveal d1" href="#" aria-label="TELOS Farm — available now">
                <div className="glow" /><div className="beam" /><div className="vignette" /><div className="dust" />
                <div className="gate-window">
                  <div className="cgi-cue empty-cue"><i className="ph-light ph-plant" /><div className="n">CGI #3 · TELOS Farm</div></div>
                  <span className="annotation gate-status live"><span className="dot" />Available now</span>
                </div>
                <div className="gate-body">
                  <h3 className="display h-gate">TELOS Farm</h3>
                  <p className="gate-line">For growers who sell what they grow.</p>
                  <span className="cta gate-cta">Enter <span className="arrow" aria-hidden="true">→</span></span>
                </div>
              </a>

              <a className="gate gate-home cgi lit standard reveal d2" href="#" aria-label="TELOS Home — soon">
                <div className="glow" /><div className="vignette" /><div className="dust" />
                <div className="gate-window">
                  <div className="cgi-cue empty-cue"><i className="ph-light ph-cooking-pot" /><div className="n">CGI #4 · TELOS Home</div></div>
                  <span className="gate-status soon">Soon</span>
                </div>
                <div className="gate-body">
                  <h3 className="display h-gate">TELOS Home</h3>
                  <p className="gate-line">Restaurant-quality herbs on your kitchen counter.</p>
                </div>
              </a>

              <div className="gate gate-garden cgi lit quiet reveal d3" aria-label="TELOS Garden — soon">
                <div className="glow" /><div className="vignette" /><div className="dust" />
                <div className="gate-window">
                  <div className="cgi-cue empty-cue"><i className="ph-light ph-tree" /><div className="n">CGI #5 · TELOS Garden</div></div>
                  <span className="gate-status soon">Soon</span>
                </div>
                <div className="gate-body">
                  <h3 className="display h-gate">TELOS Garden</h3>
                  <p className="gate-line">A backyard that simply <em>thrives</em>.</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 6 · WHERE WE START */}
        <section className="section" id="where-we-start">
          <div className="section-inner warm-pool start-grid">
            <h2 className="display h-section start-head reveal">We can grow almost anything.<br />We start with the ones<br />worth obsessing over.</h2>
            <ul className="start-list">
              <li className="start-item reveal d1">
                <span className="start-desc">The basil you&apos;d smell before you see it.</span>
                <span className="start-name">Genovese · Liguria</span>
              </li>
              <li className="start-item reveal d2">
                <span className="start-desc">The tomato with a birthplace and an argument behind it.</span>
                <span className="start-name">Heirloom · San Marzano</span>
              </li>
              <li className="start-item reveal d3">
                <span className="start-desc">The greens a chef asks for by name.</span>
                <span className="start-name">Specialty leaf</span>
              </li>
            </ul>
            <p className="subline start-close reveal d3">Specialty crops first — the ones people already love, grown to the version they were meant to be. <b>Everything else follows.</b></p>
          </div>
        </section>

        {/* 7 · THE INVITATION */}
        <section className="section section-invitation lit breathing" id="invitation">
          <div className="glow invite-glow" /><div className="beam invite-beam" /><div className="vignette" /><div className="dust" />
          <div className="section-inner invite-inner">
            <h2 className="display h-section invite-head reveal">Try it with one crop.</h2>
            <p className="subline invite-sub reveal d1">One plant, one season. See the difference yourself before anything else.</p>
            <a className="cta-solid reveal d2" href="#">Start here <span aria-hidden="true">→</span></a>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <div className="wordmark">TELOS</div>
            <div className="footer-tag">Every plant, its fullest self.</div>
          </div>
          <nav className="footer-nav">
            <div className="footer-col">
              <span className="col-h">Grow with us</span>
              <a href="#">TELOS Farm <span className="footer-soon">· available now</span></a>
              <a href="#">TELOS Home <span className="footer-soon">· soon</span></a>
              <a href="#">TELOS Garden <span className="footer-soon">· soon</span></a>
            </div>
            <div className="footer-col">
              <span className="col-h">The company</span>
              <a href="#brain">The Brain</a>
              <a href="#">Building the third place</a>
              <a href="#invitation">Begin</a>
            </div>
          </nav>
        </div>
        <div className="footer-base">
          <span>© 2026 TELOS — love that now has tools.</span>
          <span>Soil and growth, never tech and chrome.</span>
        </div>
      </footer>
    </div>
  );
}
