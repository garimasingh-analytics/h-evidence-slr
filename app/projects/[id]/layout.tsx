import WizardNav from '@/components/WizardNav';

interface ProjectLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ProjectLayout({ children, params }: ProjectLayoutProps) {
  const { id } = await params;

  return (
    <div className="flex flex-col h-full">
      <WizardNav projectId={id} />
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
}
