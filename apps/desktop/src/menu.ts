import { Menu, type MenuItemConstructorOptions } from "electron";

/**
 * Minimal native menu. Edit roles make copy/paste work in text inputs. File and zoom shortcuts
 * are handled by the web app (keydown), so there is deliberately no File or zoom menu here.
 */
export const installMenu = (isDev: boolean): void => {
  const template: MenuItemConstructorOptions[] = [
    { role: "appMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        ...(isDev
          ? ([{ role: "reload" }, { role: "toggleDevTools" }] as MenuItemConstructorOptions[])
          : []),
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};
