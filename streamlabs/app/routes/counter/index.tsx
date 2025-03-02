import { useLoaderData, useRevalidator } from "@remix-run/react";
import { useEffect } from "react";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";

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

export default function Counter() {
  const label = 'my count';
  const count = 2;
  
  return (
    <div className="counter-container">
      <h2>{label}</h2>
      <div className="counter-value">{count}</div>
    </div>
  );
}