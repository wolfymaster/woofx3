import { useLoaderData, useRevalidator } from "@remix-run/react";
import { useEffect } from "react";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { id, i, init, InstaQLEntity } from "@instantdb/react";
import { useSearchParams } from "@remix-run/react";

// Define the data structure
type CounterData = {
  count: number;
  label: string;
};

// Loader function to fetch counter data from server
export async function loader({ request, params }: LoaderFunctionArgs) {
  // You would typically fetch this data from a database or API
  // This is a placeholder for your actual data source
  const data: CounterData = {
    count: 42, // Replace with actual data fetch
    label: "Visitors", // Replace with actual data fetch
  };
  
  return data;
}

export const meta: MetaFunction = () => {
  return [
    { title: "Counter" },
    { name: "description", content: "Count Stuff" },
  ];
};

const APP_ID = "8c28dd52-4859-4560-8d45-2408b064b248";

const schema = i.schema({
  entities: {
    counts: i.entity({
      count: i.number(),
      goal: i.number(),
      label: i.string(),
    }),
  },
});


const db = init({ appId: APP_ID, schema });

export default function Counter() {
  const [searchParams] = useSearchParams();

  console.log(searchParams.get('counterId'));

  const { isLoading, error, data } = db.useQuery({
    counts: {
      $: {
        where: {
          id: searchParams.get('counterId') || ''
        }
      }
    }
  });


  if(isLoading) {
    return <></>;
  }

  if(data?.counts.length == 0) {
    return <>Invalid Counter Id</>
  }

  const label = data?.counts[0].label;
  const count = data?.counts[0].count;
  const goal = data?.counts[0].goal;
  
  return (
    <div className="counter-container">
      <h2 style={{ textShadow: '#000 1px 1px 2px' }} className="bg-white/50 text-red-400 text-4xl">{label}: {count}/{goal}</h2>
    </div>
  );
}