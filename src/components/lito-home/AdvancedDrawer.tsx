'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export type AdvancedDrawerLink = {
  id: string;
  label: string;
  description: string;
  href: string;
};

type AdvancedDrawerProps = {
  open: boolean;
  title: string;
  subtitle: string;
  links: AdvancedDrawerLink[];
  onClose: () => void;
};

export default function AdvancedDrawer({ open, title, subtitle, links, onClose }: AdvancedDrawerProps) {
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  return (
    <>
      <div
        className="lito-home-drawer-overlay"
        data-open={open ? 'true' : 'false'}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="lito-home-drawer" data-open={open ? 'true' : 'false'} aria-hidden={!open}>
        <header className="lito-home-drawer-header">
          <p className="lito-home-drawer-eyebrow">LITO</p>
          <h2 className="lito-home-drawer-title">{title}</h2>
          <p className="lito-home-drawer-subtitle">{subtitle}</p>
        </header>
        <div className="lito-home-drawer-links">
          {links.map((link) => (
            <Link key={link.id} href={link.href} className="lito-home-drawer-link" onClick={onClose}>
              <span className="lito-home-drawer-link-label">{link.label}</span>
              <span className="lito-home-drawer-link-description">{link.description}</span>
            </Link>
          ))}
        </div>
      </aside>
    </>
  );
}
