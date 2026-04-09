type AfterBindingsCallbackRegistrar = (callback: () => void) => void;

export function initSettingsNavigation(
  registerAfterBindingsCallback: AfterBindingsCallbackRegistrar,
): void {
  const toc = document.getElementById('settings-toc');

  if (!toc) {
    return;
  }

  const tocLinks = Array.from(toc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'));
  const getSectionByLink = (link: HTMLAnchorElement): HTMLElement | null => {
    const id = link.getAttribute('href')!.slice(1);

    return document.getElementById(id);
  };

  const getSectionActivationTarget = (section: HTMLElement): HTMLElement =>
    section.querySelector<HTMLElement>(':scope > h6, :scope > summary') ?? section;

  const scrollTocToLink = (link: HTMLAnchorElement): void => {
    const tocRect = toc.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const offset = linkRect.left - tocRect.left + linkRect.width / 2 - tocRect.width / 2;

    toc.scrollBy({ left: offset, behavior: 'smooth' });
  };

  const setActiveLink = (link: HTMLAnchorElement | null, syncToc = false): void => {
    if (!link || link.style.display === 'none' || link.classList.contains('search-hidden')) {
      return;
    }

    if (activeLink === link) {
      return;
    }

    activeLink?.classList.remove('active');
    link.classList.add('active');
    activeLink = link;

    if (syncToc) {
      scrollTocToLink(link);
    }
  };

  const clearStaleFocusedTocLink = (): void => {
    const focusedLink = document.activeElement;

    if (
      focusedLink instanceof HTMLAnchorElement &&
      toc.contains(focusedLink) &&
      focusedLink !== activeLink
    ) {
      focusedLink.blur();
    }
  };

  const getActivationOffsetForScroll = (scrollTop: number): number => {
    const stickyHeaderBottom =
      document.querySelector<HTMLElement>('.settings-search')?.getBoundingClientRect().bottom ?? 0;
    const baseOffset = Math.max(stickyHeaderBottom + 24, Math.round(window.innerHeight * 0.32));
    const lowerOffset = Math.max(stickyHeaderBottom + 24, Math.round(window.innerHeight * 0.9));
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;

    if (maxScroll <= 0) {
      return baseOffset;
    }

    const scrollProgress = scrollTop / maxScroll;

    if (scrollProgress <= 0.66) {
      return baseOffset;
    }

    const bottomThirdProgress = Math.min(1, (scrollProgress - 0.66) / 0.34);

    return Math.round(baseOffset + (lowerOffset - baseOffset) * bottomThirdProgress);
  };

  const getActivationOffset = (): number => getActivationOffsetForScroll(window.scrollY);

  const getClickOffset = (): number => {
    const stickyHeaderBottom =
      document.querySelector<HTMLElement>('.settings-search')?.getBoundingClientRect().bottom ?? 0;

    return Math.max(stickyHeaderBottom + 24, Math.round(window.innerHeight * 0.28));
  };

  const getVisibleSectionLink = (): HTMLAnchorElement | null => {
    const visibleLinks = tocLinks.filter(
      (link) => link.style.display !== 'none' && !link.classList.contains('search-hidden'),
    );

    if (!visibleLinks.length) {
      return null;
    }

    const activationOffset = getActivationOffset();
    let activeCandidate: HTMLAnchorElement | null = null;
    let firstUpcoming: HTMLAnchorElement | null = null;

    for (const link of visibleLinks) {
      const section = getSectionByLink(link);

      if (
        !section ||
        section.style.display === 'none' ||
        section.classList.contains('search-hidden')
      ) {
        continue;
      }

      const activationTarget = getSectionActivationTarget(section);
      const sectionTop = activationTarget.getBoundingClientRect().top;

      if (sectionTop <= activationOffset) {
        activeCandidate = link;

        continue;
      }

      firstUpcoming ??= link;

      break;
    }

    return activeCandidate ?? firstUpcoming ?? visibleLinks[0];
  };

  const getNextVisibleSection = (section: HTMLElement): HTMLElement | null => {
    const visibleLinks = tocLinks.filter(
      (link) => link.style.display !== 'none' && !link.classList.contains('search-hidden'),
    );
    const currentIndex = visibleLinks.findIndex((link) => getSectionByLink(link) === section);

    if (currentIndex < 0) {
      return null;
    }

    for (const link of visibleLinks.slice(currentIndex + 1)) {
      const nextSection = getSectionByLink(link);

      if (
        nextSection &&
        nextSection.style.display !== 'none' &&
        !nextSection.classList.contains('search-hidden')
      ) {
        return nextSection;
      }
    }

    return null;
  };

  const scrollToSection = (section: HTMLElement): void => {
    const activationTarget = getSectionActivationTarget(section);
    const nextSection = getNextVisibleSection(section);
    const nextActivationTarget = nextSection ? getSectionActivationTarget(nextSection) : null;
    const clickOffset = getClickOffset();
    const clickBuffer = 28;
    const nextHeadingBuffer = 24;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const desiredTop =
      window.scrollY +
      activationTarget.getBoundingClientRect().top -
      Math.max(0, clickOffset - clickBuffer);
    const nextHeadingDocTop = nextActivationTarget
      ? window.scrollY + nextActivationTarget.getBoundingClientRect().top
      : null;
    let maxAllowedTop = maxScroll;

    if (nextHeadingDocTop !== null) {
      maxAllowedTop = Math.min(
        maxScroll,
        Math.max(
          0,
          Math.round(
            nextHeadingDocTop - getActivationOffsetForScroll(maxScroll) - nextHeadingBuffer,
          ),
        ),
      );

      for (let i = 0; i < 6; i += 1) {
        const refinedTop =
          nextHeadingDocTop - getActivationOffsetForScroll(maxAllowedTop) - nextHeadingBuffer;
        const boundedTop = Math.min(maxScroll, Math.max(0, refinedTop));

        if (Math.abs(boundedTop - maxAllowedTop) < 1) {
          maxAllowedTop = boundedTop;

          break;
        }

        maxAllowedTop = boundedTop;
      }
    }

    const scrollTop = Math.min(
      maxScroll,
      Math.max(0, Math.round(Math.min(desiredTop, maxAllowedTop))),
    );

    window.scrollTo({ top: scrollTop, behavior: 'smooth' });
  };

  let activeSyncQueued = false;
  const queueActiveLinkSync = (): void => {
    if (activeSyncQueued) {
      return;
    }

    activeSyncQueued = true;

    window.requestAnimationFrame(() => {
      activeSyncQueued = false;
      setActiveLink(getVisibleSectionLink());
      clearStaleFocusedTocLink();
    });
  };

  toc.addEventListener('click', (e: Event) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');

    if (!link) {
      return;
    }

    e.preventDefault();

    const target = getSectionByLink(link);

    if (target) {
      if (target instanceof HTMLDetailsElement && !target.open) {
        target.open = true;
      }

      setActiveLink(link, true);
      scrollToSection(target);
      queueActiveLinkSync();
    }
  });

  let activeLink: HTMLAnchorElement | null = null;

  window.addEventListener('scroll', queueActiveLinkSync, { passive: true });
  window.addEventListener('resize', queueActiveLinkSync);
  queueActiveLinkSync();
  registerAfterBindingsCallback(() => {
    queueActiveLinkSync();
  });
}

export function initSettingsSearch(
  registerAfterBindingsCallback: AfterBindingsCallbackRegistrar,
): void {
  const toc = document.getElementById('settings-toc');
  const searchInput = document.getElementById('settings-search') as HTMLInputElement | null;

  if (!searchInput) {
    return;
  }

  const searchSections: {
    el: HTMLElement;
    heading: string;
    tocLink: HTMLAnchorElement | null;
    items: { el: HTMLElement; text: string; container: HTMLElement | null }[];
    containers: Set<HTMLElement>;
  }[] = [];
  const searchOpenedDetails = new Set<HTMLDetailsElement>();
  const sectionSelector = 'form > .section[id], form > details.section-collapsible[id]';

  for (const sectionEl of document.querySelectorAll<HTMLElement>(sectionSelector)) {
    const heading = sectionEl.querySelector(':scope > h6, :scope > summary');
    const tocLink = toc?.querySelector<HTMLAnchorElement>(`a[href="#${sectionEl.id}"]`) ?? null;
    const items: { el: HTMLElement; text: string; container: HTMLElement | null }[] = [];
    const containers = new Set<HTMLElement>();

    for (const fbp of sectionEl.querySelectorAll<HTMLElement>('.form-box-parent')) {
      containers.add(fbp);

      for (const fb of fbp.querySelectorAll<HTMLElement>(':scope > .form-box')) {
        for (const child of Array.from(fb.children) as HTMLElement[]) {
          if (child.tagName !== 'DIV') {
            continue;
          }

          items.push({ el: child, text: gatherText(child), container: fbp });
        }
      }
    }

    for (const acc of sectionEl.querySelectorAll<HTMLDetailsElement>('details.accordion')) {
      if (acc.closest('.form-box-parent')) {
        continue;
      }

      items.push({ el: acc, text: gatherText(acc), container: null });
    }

    searchSections.push({
      el: sectionEl,
      heading: heading?.textContent?.toLowerCase().trim() ?? '',
      tocLink,
      items,
      containers,
    });
  }

  function gatherText(el: HTMLElement): string {
    const parts: string[] = [];

    for (const node of el.querySelectorAll('label, p, summary')) {
      if (node.textContent) {
        parts.push(node.textContent);
      }
    }

    return parts.join(' ').toLowerCase();
  }

  function isHiddenByShow(el: HTMLElement, root: HTMLElement): boolean {
    if (root.style.display === 'none') {
      return true;
    }

    let cur: HTMLElement | null = el;

    while (cur && cur !== root) {
      if (cur.style.display === 'none') {
        return true;
      }

      cur = cur.parentElement;
    }

    return false;
  }

  let searchTimer: ReturnType<typeof setTimeout> | null = null;

  searchInput.addEventListener('input', () => {
    if (searchTimer) {
      clearTimeout(searchTimer);
    }

    searchTimer = setTimeout(runSearch, 150);
  });

  searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      clearSearch();
    }
  });

  searchInput.addEventListener('search', () => {
    if (!searchInput.value) {
      clearSearch();
    }
  });

  function runSearch(): void {
    const query = searchInput.value.trim().toLowerCase();

    if (!query) {
      clearSearch();

      return;
    }

    for (const section of searchSections) {
      let sectionHasMatch = false;
      const headingMatches = section.heading.includes(query);
      const containerHits = new Map<HTMLElement, number>();

      for (const c of section.containers) {
        containerHits.set(c, 0);
      }

      for (const item of section.items) {
        if (isHiddenByShow(item.el, section.el)) {
          continue;
        }

        const matches = headingMatches || item.text.includes(query);

        item.el.classList.toggle('search-hidden', !matches);
        item.el.classList.toggle('search-match', matches);

        if (matches) {
          sectionHasMatch = true;

          if (item.container) {
            containerHits.set(item.container, (containerHits.get(item.container) ?? 0) + 1);
          }

          if (item.el instanceof HTMLDetailsElement && !item.el.open) {
            item.el.open = true;
            searchOpenedDetails.add(item.el);
          }
        }
      }

      for (const [c, hits] of containerHits) {
        c.classList.toggle('search-hidden', hits === 0);
      }

      section.el.classList.toggle('search-hidden', !sectionHasMatch);
      section.tocLink?.classList.toggle('search-hidden', !sectionHasMatch);

      if (sectionHasMatch && section.el instanceof HTMLDetailsElement && !section.el.open) {
        section.el.open = true;
        searchOpenedDetails.add(section.el);
      }
    }
  }

  function clearSearch(): void {
    searchInput.value = '';

    for (const section of searchSections) {
      section.el.classList.remove('search-hidden');
      section.tocLink?.classList.remove('search-hidden');

      for (const c of section.containers) {
        c.classList.remove('search-hidden');
      }

      for (const item of section.items) {
        item.el.classList.remove('search-hidden', 'search-match');
      }
    }

    for (const d of searchOpenedDetails) {
      d.open = false;
    }

    searchOpenedDetails.clear();
  }

  registerAfterBindingsCallback(() => {
    if (searchInput.value.trim()) {
      runSearch();
    }
  });
}
