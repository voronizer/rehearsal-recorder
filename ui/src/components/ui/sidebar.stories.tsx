import type { Meta, StoryObj } from "@storybook/react-vite"
import { Mic, Music, Settings } from "lucide-react"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "./sidebar"

const meta = {
  title: "UI/Sidebar",
  component: SidebarProvider,
} satisfies Meta<typeof SidebarProvider>

export default meta
type Story = StoryObj<typeof meta>

const ITEMS = [
  { name: "Rehearsals", icon: Mic, active: true },
  { name: "Songs", icon: Music, active: false },
  { name: "Settings", icon: Settings, active: false },
]

function Menu({ collapsible }: { collapsible: "icon" | "none" }) {
  return (
    <div
      className="relative h-64 w-[36rem] overflow-hidden rounded-lg border"
      style={
        {
          "--sidebar-width": "12rem",
          "--sidebar-width-mobile": "16rem",
          "--sidebar-width-icon": "3rem",
        } as React.CSSProperties
      }
    >
      <SidebarProvider className="min-h-0 h-full">
        <Sidebar collapsible={collapsible} className="absolute h-full">
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Band</SidebarGroupLabel>
              <SidebarMenu>
                {ITEMS.map(({ name, icon: Icon, active }) => (
                  <SidebarMenuItem key={name}>
                    <SidebarMenuButton tooltip={name} isActive={active} className="data-[active=true]:bg-selected">
                      <Icon />
                      <span>{name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
      </SidebarProvider>
    </div>
  )
}

/** Inside the page's area, not the window: the caller places it with className. */
export const Default: Story = { render: () => <Menu collapsible="none" /> }

/** Folded to its icons; the names show in tips. */
export const Icons: Story = { render: () => <Menu collapsible="icon" /> }
