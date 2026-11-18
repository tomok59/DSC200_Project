# **Spec: \<website for visualizing chicago crashes\>**

## **Goal and user**

This is for a class project, but we want this to be usable by anyone including the city of Chicago and any services that may derive a benefit from it. *Outputs should be a cleaned csv file of the Chicago Traffic Accident dataset and a website that visualizes the data and allows for filtering to aid data analysis.* 

## **Inputs**

The following columns come from our dataset: CRASH\_RECORD\_ID	CRASH\_DATE\_EST\_I	CRASH\_DATE	POSTED\_SPEED\_LIMIT	TRAFFIC\_CONTROL\_DEVICE	DEVICE\_CONDITION	WEATHER\_CONDITION	LIGHTING\_CONDITION	FIRST\_CRASH\_TYPE	TRAFFICWAY\_TYPE	LANE\_CNT	ALIGNMENT	ROADWAY\_SURFACE\_COND	ROAD\_DEFECT	REPORT\_TYPE	CRASH\_TYPE	INTERSECTION\_RELATED\_I	NOT\_RIGHT\_OF\_WAY\_I	HIT\_AND\_RUN\_I	DAMAGE	DATE\_POLICE\_NOTIFIED	PRIM\_CONTRIBUTORY\_CAUSE	SEC\_CONTRIBUTORY\_CAUSE	STREET\_NO	STREET\_DIRECTION	STREET\_NAME	BEAT\_OF\_OCCURRENCE	PHOTOS\_TAKEN\_I	STATEMENTS\_TAKEN\_I	DOORING\_I	WORK\_ZONE\_I	WORK\_ZONE\_TYPE	WORKERS\_PRESENT\_I	NUM\_UNITS	CRASH\_MONTH	MOST\_SEVERE\_INJURY	INJURIES\_TOTAL	INJURIES\_FATAL	INJURIES\_INCAPACITATING	INJURIES\_NON\_INCAPACITATING	INJURIES\_REPORTED\_NOT\_EVIDENT	INJURIES\_NO\_INDICATION	INJURIES\_UNKNOWN	CRASH\_HOUR	CRASH\_DAY\_OF\_WEEK	IDOT\_CONTROL\_NO	LATITUDE	LONGITUDE	LOCATION

First row for format:

807805	c8f7cab0c4d9a436b59242e5dfc5d1c9f9dff38f9fce08...	NaN	08/05/2017 02:22:00 PM	30	NO CONTROLS	NO CONTROLS	CLOUDY/OVERCAST	DAYLIGHT	PEDESTRIAN	ONE-WAY	1	STRAIGHT AND LEVEL	DRY	NO DEFECTS	ON SCENE	INJURY AND / OR TOW DUE TO CRASH	NaN	NaN	NaN	OVER \$1,500	08/05/2017 02:35:00 PM	FAILING TO YIELD RIGHT-OF-WAY	NOT APPLICABLE	5525	S	MERRIMAC AVE	811.0	NaN	NaN	NaN	NaN	NaN	NaN	2	8	NONINCAPACITATING INJURY	1.0	0.0	0.0	1.0	0.0	1.0	0.0	14	7	X000870806	41.791647	\-87.777979	POINT (-87.777978734176 41.791647349476)

Here is a dataset which describes Chicago neighborhoods for you to add our neighborhood column:   
\`data/chicago\_neighborhoods.geojson\`: the City of Chicago's 98 neighborhood boundary polygons ("Boundaries \- Neighborhoods", Chicago Data Portal dataset \`y6yq-dbs2\`). 

## **Outputs**

First, a cleaned csv output that fits all of our definitions and rules. We also want a summary that documents every row that was dropped and why. 

Finally, our main output will be for you to create a visualizing stunning website hosted on github that can help us visualize the data from the crash dataset, and be able to set filters on all of the relevant columns (for example be able to filter on time of day, weather condition etc..).

You also need to complete the Project update rubric dsc200\_fa26 file. 

## **Definitions and rules**

1. We only want data from 2021 and up until June of 2026\.  
2. You also need to inform me of any decisions you make as to how you filter or clean the data.  
3. Drop any repeated rows based on the CRASH\_RECORD\_ID  
4. Coordinates that are missing, zero, or outside a generous Chicago box (lat 41.64–42.03, lon −87.95–−87.52) drop the entire row  
5. The Y/N indicator columns become \`YES\` when the value is \`Y\` and \`NO\` otherwise.  
6. \`POSTED\_SPEED\_LIMIT\` is bucketed: \`0 (none posted)\`, \`5–10\`, \`15\`, \`20\`, \`25\`, \`30\`, \`35\`, \`40\`, \`45\`, \`50+\`, and \`INVALID ENTRY\` for values that are not multiples of 5 or exceed 70\. \|  
7. Missing injury counts are treated as \*\*0\*\* and a missing \`MOST\_SEVERE\_INJURY\` as \`UNKNOWN\`. Derived flags: \`ANY\_INJURY\` (total \> 0), \`KSI\` (killed or seriously injured: fatal \+ incapacitating \> 0), \`FATAL\`.  
8. \`NUM\_UNITS\` is bucketed \`1\`, \`2\`, \`3\`, \`4+\`.  
9. Hundred-block is \`floor(STREET\_NO / 100\) × 100\` \+ direction \+ street name.  
10. A missing \`WORK\_ZONE\_TYPE\` becomes \`NOT A WORK ZONE\`; a missing police beat becomes \`UNKNOWN\`.  
11. If the date of police notification is more than 30 days after the date of the accident, we drop those rows. Create a column called TIME\_CRASH\_TO\_NOTIFY \= DATE\_POLICE\_NOTIFIED \- CRASH\_DATE in hours, rounded to 2 decimals  
12. Hour, weekday, month and year are \*\*recomputed from \`CRASH\_DATE\`\*\* rather than read from \`CRASH\_HOUR\` / \`CRASH\_DAY\_OF\_WEEK\` / \`CRASH\_MONTH\`. \| One source of truth for time. Weekday keeps the dataset's convention (1 \= Sunday).  
13. Create a column called NEIGHBORHOOD that holds the name of the neighborhood polygon (from \`data/chicago\_neighborhoods.geojson\`) each row's LATITUDE/LONGITUDE falls in. We should be able to filter by neighborhood. 

## **Acceptance criteria**

A running website with all of the filters and visualization we specified. Also to have completed the update rubric completely. No row in output breaks any rule. The input file is not modified, only a cleaned copy is created. Running the script twice gives an identical output file if the input file is the same.

## **Performance budget**

I want the website to run smoothly on most computers.

Websites should update with 500ms on most computers.

## **Open questions**

Let me know if there are any open questions that I have not thought of that need to be addressed.