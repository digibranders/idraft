'use client';

import type { Route } from 'next';
import { useState, type ReactNode } from 'react';

import { SpecimenGroup, SpecimenRow } from './specimen';
import { ProjectSwitcher, type SwitcherProject } from '@/components/app/shell/project-switcher';

const PROJECTS: readonly SwitcherProject[] = [
  { id: 'eventus', name: 'Eventus Security', timeZone: 'Asia/Kolkata', domain: 'eventussecurity.com' },
  { id: 'cleanstart', name: 'Cleanstart', timeZone: 'Asia/Kolkata', domain: 'cleanstart.com' },
  { id: 'fynix', name: 'Fynix', timeZone: 'Europe/Berlin', domain: 'fynix.digital' },
  { id: 'new', name: 'New project', timeZone: 'Asia/Kolkata', domain: null },
];

/** The sidebar's project switcher with the real component: the icon of each project's site, its name and its domain. */
export function ProjectSwitcherSpecimen(): ReactNode {
  const [current, setCurrent] = useState<SwitcherProject>(PROJECTS[0] ?? { id: '', name: '', timeZone: '' });
  const [bare, setBare] = useState<SwitcherProject>(PROJECTS[3] ?? { id: '', name: '', timeZone: '' });
  const links = {
    allProjects: { href: '/digibranders' as Route, label: 'All projects in Digibranders' },
    createProject: { href: '/digibranders/onboarding' as Route, label: 'Create project' },
  };
  return (
    <SpecimenGroup
      title="Project switcher"
      note="11 section 8, 07 section 5. The icon of the project's primary domain, found with no upload, on a light tile; the first letter where the site has none."
    >
      <SpecimenRow label="Sidebar, with a domain">
        <div className="w-60">
          <ProjectSwitcher
            current={current}
            projects={PROJECTS}
            onSelect={setCurrent}
            presentation="sidebar"
            {...links}
          />
        </div>
      </SpecimenRow>
      <SpecimenRow label="Sidebar, no domain yet">
        <div className="w-60">
          <ProjectSwitcher current={bare} projects={PROJECTS} onSelect={setBare} presentation="sidebar" {...links} />
        </div>
      </SpecimenRow>
    </SpecimenGroup>
  );
}
