import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://browser-cli.zerith.app',
  redirects: {
    '/': '/en/',
  },
  integrations: [
    starlight({
      title: {
        en: 'browser-cli',
        'zh-CN': 'browser-cli',
      },
      description:
        'Run TypeScript workflows against your own logged-in Chrome. No scraping farm, no bespoke infra.',
      defaultLocale: 'en',
      locales: {
        en: { label: 'English' },
        'zh-cn': { label: '简体中文', lang: 'zh-CN' },
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/browser-cli/browser-cli',
        },
      ],
      sidebar: [
        {
          label: 'Introduction',
          translations: { 'zh-CN': '介绍' },
          link: '/introduction/',
        },
        {
          label: 'Install',
          translations: { 'zh-CN': '安装' },
          link: '/install/',
        },
        {
          label: 'Concepts',
          translations: { 'zh-CN': '核心概念' },
          items: [
            {
              label: 'Workflow',
              translations: { 'zh-CN': 'Workflow' },
              link: '/concepts/workflow/',
            },
            {
              label: 'Task',
              translations: { 'zh-CN': 'Task' },
              link: '/concepts/task/',
            },
            {
              label: 'Rate limit & concurrency',
              translations: { 'zh-CN': '限速与并发' },
              link: '/concepts/rate-limit/',
            },
          ],
        },
        {
          label: 'Design Philosophy',
          translations: { 'zh-CN': '设计哲学' },
          link: '/philosophy/',
        },
        {
          label: 'Features',
          translations: { 'zh-CN': '特性' },
          link: '/features/',
        },
      ],
    }),
  ],
});
