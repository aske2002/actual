import * as api from '@actual-app/api';
import type { Command } from 'commander';

import { withConnection } from '../connection';
import { printOutput } from '../output';

export function registerCategoryGroupsCommand(program: Command) {
  const groups = program
    .command('category-groups')
    .description('Manage category groups');

  groups
    .command('list')
    .description('List all category groups')
    .action(async () => {
      const opts = program.opts();
      await withConnection(opts, async () => {
        const result = await api.getCategoryGroups();
        printOutput(result, opts.format);
      });
    });

  groups
    .command('create')
    .description('Create a new category group')
    .requiredOption('--name <name>', 'Group name')
    .option('--is-income', 'Mark as income group', false)
    .action(async cmdOpts => {
      const opts = program.opts();
      await withConnection(opts, async () => {
        const id = await api.createCategoryGroup({
          name: cmdOpts.name,
          is_income: cmdOpts.isIncome,
          hidden: false,
        });
        printOutput({ id }, opts.format);
      });
    });

  groups
    .command('update <id>')
    .description('Update a category group')
    .option('--name <name>', 'New group name')
    .option('--hidden <bool>', 'Set hidden status')
    .action(async (id: string, cmdOpts) => {
      const opts = program.opts();
      await withConnection(opts, async () => {
        const fields: Record<string, unknown> = {};
        if (cmdOpts.name !== undefined) fields.name = cmdOpts.name;
        if (cmdOpts.hidden !== undefined) {
          fields.hidden = cmdOpts.hidden === 'true';
        }
        await api.updateCategoryGroup(id, fields);
        printOutput({ success: true, id }, opts.format);
      });
    });

  groups
    .command('delete <id>')
    .description('Delete a category group')
    .option('--transfer-to <id>', 'Transfer categories to this category group')
    .action(async (id: string, cmdOpts) => {
      const opts = program.opts();
      await withConnection(opts, async () => {
        await api.deleteCategoryGroup(id, cmdOpts.transferTo);
        printOutput({ success: true, id }, opts.format);
      });
    });
}
